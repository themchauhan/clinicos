"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logPlatformAdminAudit, logAuditFromServiceRole } from "@/lib/audit/log";
import type { HospitalStatus, ModuleType } from "@/types/database";

export interface CreateHospitalState {
  error?: string;
}

const VALID_MODULES: readonly ModuleType[] = ["GENERAL_OPD", "USG"];

export async function createHospital(
  _prevState: CreateHospitalState,
  formData: FormData,
): Promise<CreateHospitalState> {
  // requireRole(["SUPER_ADMIN"]) alone is sufficient here:
  // getSessionProfile() already returns null for a SUPER_ADMIN profile
  // with no platform_admins row (Phase 1b), so a non-null profile with
  // this role is already a verified platform admin.
  requireRole(await getSessionProfile(), ["SUPER_ADMIN"]);

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const modules = formData.getAll("modules").map(String) as ModuleType[];
  const adminName = String(formData.get("adminName") ?? "").trim();
  const adminEmail = String(formData.get("adminEmail") ?? "")
    .trim()
    .toLowerCase();

  if (!name) {
    return { error: "Enter a centre name." };
  }
  if (modules.length === 0 || modules.some((m) => !VALID_MODULES.includes(m))) {
    return { error: "Choose at least one module." };
  }
  if (!adminName || !adminEmail) {
    return { error: "Enter the first admin's name and email." };
  }

  const supabase = await createClient();

  const { data: hospital, error: hospitalError } = await supabase
    .from("hospitals")
    .insert({ name, address, phone, email })
    .select("id")
    .single();
  if (hospitalError || !hospital) {
    return { error: "Could not create the centre. Try again." };
  }

  const { error: modulesError } = await supabase
    .from("hospital_modules")
    .insert(modules.map((module) => ({ hospital_id: hospital.id, module })));
  if (modulesError) {
    return { error: "Centre created, but could not enable its modules. Contact support." };
  }

  const serviceRole = createServiceRoleClient();
  const { data: invited, error: inviteError } = await serviceRole.auth.admin.inviteUserByEmail(
    adminEmail,
    { data: { name: adminName } },
  );
  if (inviteError || !invited.user) {
    return {
      error: `Centre created, but could not invite ${adminEmail}: ${inviteError?.message ?? "unknown error"}`,
    };
  }

  const { error: profileError } = await serviceRole.from("profiles").insert({
    id: invited.user.id,
    hospital_id: hospital.id,
    name: adminName,
    email: adminEmail,
    role: "HOSPITAL_ADMIN",
    status: "ACTIVE",
  });
  if (profileError) {
    return { error: "Centre created and admin invited, but could not create their staff record." };
  }

  await logPlatformAdminAudit({
    targetHospitalId: hospital.id,
    action: "hospital.created",
    targetType: "hospital",
    targetId: hospital.id,
    metadata: { modules, adminEmail },
  });

  revalidatePath("/admin");
  redirect(`/admin/hospitals/${hospital.id}`);
}

export async function updateHospitalStatus(
  hospitalId: string,
  status: HospitalStatus,
): Promise<{ error?: string }> {
  requireRole(await getSessionProfile(), ["SUPER_ADMIN"]);

  const supabase = await createClient();
  const { error } = await supabase.from("hospitals").update({ status }).eq("id", hospitalId);
  if (error) {
    return { error: "Could not update that centre's status." };
  }

  await logPlatformAdminAudit({
    targetHospitalId: hospitalId,
    action: "hospital.status_changed",
    targetType: "hospital",
    targetId: hospitalId,
    metadata: { status },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/hospitals/${hospitalId}`);
  return {};
}

export async function updateHospitalPlan(
  hospitalId: string,
  plan: string,
): Promise<{ error?: string }> {
  requireRole(await getSessionProfile(), ["SUPER_ADMIN"]);

  const trimmed = plan.trim();
  if (!trimmed) {
    return { error: "Enter a plan name." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("hospitals").update({ plan: trimmed }).eq("id", hospitalId);
  if (error) {
    return { error: "Could not update that centre's plan." };
  }

  await logPlatformAdminAudit({
    targetHospitalId: hospitalId,
    action: "hospital.plan_changed",
    targetType: "hospital",
    targetId: hospitalId,
    metadata: { plan: trimmed },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/hospitals/${hospitalId}`);
  return {};
}

export interface RecordPaymentState {
  error?: string;
}

export async function recordSubscriptionPayment(
  hospitalId: string,
  _prevState: RecordPaymentState,
  formData: FormData,
): Promise<RecordPaymentState> {
  requireRole(await getSessionProfile(), ["SUPER_ADMIN"]);

  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amount = amountRaw ? Number(amountRaw) : NaN;
  const paymentMethod = String(formData.get("paymentMethod") ?? "").trim();
  const referenceNumber = String(formData.get("referenceNumber") ?? "").trim() || null;
  const periodStart = String(formData.get("periodStart") ?? "").trim();
  const periodEnd = String(formData.get("periodEnd") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (Number.isNaN(amount) || amount <= 0) {
    return { error: "Enter a positive amount." };
  }
  if (!paymentMethod) {
    return { error: "Enter a payment method." };
  }
  if (!periodStart || !periodEnd) {
    return { error: "Enter the period this payment covers." };
  }
  if (periodEnd < periodStart) {
    return { error: "Period end must be on or after the period start." };
  }

  const supabase = await createClient();
  const { error: paymentError } = await supabase.from("subscription_payments").insert({
    hospital_id: hospitalId,
    amount,
    payment_method: paymentMethod,
    reference_number: referenceNumber,
    period_start: periodStart,
    period_end: periodEnd,
    notes,
  });
  if (paymentError) {
    return { error: "Could not record the payment." };
  }

  // A recorded payment naturally extends and reactivates the centre —
  // see the Phase 8 plan for why this is bundled into one action
  // rather than two separate steps an admin has to remember.
  const { data: hospital } = await supabase
    .from("hospitals")
    .select("status")
    .eq("id", hospitalId)
    .single();

  const { error: updateError } = await supabase
    .from("hospitals")
    .update({
      subscription_ends_at: periodEnd,
      ...(hospital && hospital.status !== "ACTIVE" ? { status: "ACTIVE" as HospitalStatus } : {}),
    })
    .eq("id", hospitalId);
  if (updateError) {
    return { error: "Payment recorded, but could not extend the subscription." };
  }

  await logPlatformAdminAudit({
    targetHospitalId: hospitalId,
    action: "subscription_payment.recorded",
    targetType: "hospital",
    targetId: hospitalId,
    metadata: { amount, paymentMethod, periodStart, periodEnd },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/hospitals/${hospitalId}`);
  return {};
}

async function wipeStoragePrefix(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  prefix: string,
): Promise<void> {
  const bucket = serviceRole.storage.from("documents");

  async function listAll(path: string) {
    const out: { name: string; id: string | null }[] = [];
    let offset = 0;
    const limit = 1000;
    for (;;) {
      const { data, error } = await bucket.list(path, { limit, offset });
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < limit) break;
      offset += limit;
    }
    return out;
  }

  const topLevel = await listAll(prefix);
  const filePaths: string[] = [];
  for (const entry of topLevel) {
    const entryPath = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      // A folder placeholder (e.g. a patient_id directory under a
      // hospital-level wipe) -- list one level deeper for the actual
      // files. Storage never nests more than hospital_id/patient_id/
      // file, so a single extra level is always enough here.
      const nested = await listAll(entryPath);
      filePaths.push(...nested.map((f) => `${entryPath}/${f.name}`));
    } else {
      filePaths.push(entryPath);
    }
  }

  for (let i = 0; i < filePaths.length; i += 100) {
    const chunk = filePaths.slice(i, i + 100);
    const { error } = await bucket.remove(chunk);
    if (error) throw error;
  }
}

const HOSPITAL_PURGE_DELETE_ORDER = [
  "documents",
  "visit_payments",
  "scan_sessions",
  "subscription_payments",
  "audit_logs",
  "visits",
  "doctors",
  "document_types",
  "visit_types",
  "patients",
  "profiles",
] as const;

/**
 * SUPER_ADMIN-only, explicit exception to CLAUDE.md hard rule #6 (see
 * that rule's own carve-out sentence) -- for purging an entire test
 * centre from a real deployment, not for anything a hospital's own
 * staff can reach. Deletion order below is required: almost every
 * hospital_id FK in this schema is ON DELETE RESTRICT, not CASCADE
 * (verified against every migration), so children must go before
 * parents. hospital_modules/patient_code_counters/visit_counters
 * cascade off the final hospitals delete; visit_document_requirements/
 * visit_type_document_requirements cascade off visits/document_types/
 * visit_types deleted in this same loop.
 */
export async function permanentlyDeleteHospital(hospitalId: string): Promise<{ error?: string }> {
  const profile = requireRole(await getSessionProfile(), ["SUPER_ADMIN"]);
  const serviceRole = createServiceRoleClient();

  const { data: hospital } = await serviceRole
    .from("hospitals")
    .select("id, name")
    .eq("id", hospitalId)
    .single();
  if (!hospital) {
    return { error: "Centre not found." };
  }

  // Logged first, hospital_id: null, before any deletes below can
  // fail partway and leave no record of the attempt. A real
  // hospital_id here would either block or be destroyed by this same
  // purge, since audit_logs.hospital_id is ON DELETE RESTRICT.
  await logAuditFromServiceRole({
    hospitalId: null,
    userId: profile.userId,
    action: "hospital.permanently_deleted",
    targetType: "hospital",
    targetId: hospitalId,
    metadata: { hospitalName: hospital.name },
  });

  // Storage first: Postgres FK cascades never touch Storage objects.
  await wipeStoragePrefix(serviceRole, hospitalId);

  const { data: profileRows } = await serviceRole
    .from("profiles")
    .select("id")
    .eq("hospital_id", hospitalId);
  const profileIds = (profileRows ?? []).map((p) => p.id);

  for (const table of HOSPITAL_PURGE_DELETE_ORDER) {
    const { error } = await serviceRole.from(table).delete().eq("hospital_id", hospitalId);
    if (error) {
      return { error: `Purge failed while deleting ${table}: ${error.message}` };
    }
  }

  // profiles rows for this hospital are already gone (loop above) --
  // deleteUser()'s own auth.users -> profiles cascade has nothing
  // left to cascade, so this purely revokes login credentials. A
  // failure here is logged, not fatal: the Postgres-side purge (the
  // actual data-retention concern) has already succeeded by this
  // point, and a stray auth.users row with no profile can't sign in
  // to anything anyway.
  for (const id of profileIds) {
    const { error } = await serviceRole.auth.admin.deleteUser(id);
    if (error) {
      console.error("permanentlyDeleteHospital: deleteUser failed", id, error.message);
    }
  }

  // Finally, the hospital row itself -- cascades hospital_modules,
  // patient_code_counters, visit_counters.
  const { error: hospitalDeleteError } = await serviceRole
    .from("hospitals")
    .delete()
    .eq("id", hospitalId);
  if (hospitalDeleteError) {
    return {
      error: `Purge completed data deletion, but the hospital row itself failed to delete: ${hospitalDeleteError.message}`,
    };
  }

  revalidatePath("/admin");
  redirect("/admin");
}

/**
 * Same exception as permanentlyDeleteHospital, narrower scope: deletes
 * one test patient and only their own visits/documents/scan-sessions,
 * leaving the hospital and everything else in it untouched. No
 * auth.users involved -- patients aren't staff accounts.
 */
export async function permanentlyDeletePatient(patientId: string): Promise<{ error?: string }> {
  requireRole(await getSessionProfile(), ["SUPER_ADMIN"]);
  const serviceRole = createServiceRoleClient();

  const { data: patient } = await serviceRole
    .from("patients")
    .select("id, hospital_id, name")
    .eq("id", patientId)
    .single();
  if (!patient) {
    return { error: "Patient not found." };
  }

  await logPlatformAdminAudit({
    targetHospitalId: patient.hospital_id,
    action: "patient.permanently_deleted",
    targetType: "patient",
    targetId: patientId,
    metadata: { patientName: patient.name },
  });

  await wipeStoragePrefix(serviceRole, `${patient.hospital_id}/${patientId}`);

  const { data: patientVisits } = await serviceRole
    .from("visits")
    .select("id")
    .eq("patient_id", patientId);
  const visitIds = (patientVisits ?? []).map((v) => v.id);

  const { error: documentsError } = await serviceRole
    .from("documents")
    .delete()
    .eq("patient_id", patientId);
  if (documentsError) {
    return { error: `Could not delete documents: ${documentsError.message}` };
  }

  if (visitIds.length > 0) {
    const { error: paymentsError } = await serviceRole
      .from("visit_payments")
      .delete()
      .in("visit_id", visitIds);
    if (paymentsError) {
      return { error: `Could not delete visit payments: ${paymentsError.message}` };
    }
  }

  const { error: scanSessionsError } = await serviceRole
    .from("scan_sessions")
    .delete()
    .eq("patient_id", patientId);
  if (scanSessionsError) {
    return { error: `Could not delete scan sessions: ${scanSessionsError.message}` };
  }

  const { error: visitsError } = await serviceRole
    .from("visits")
    .delete()
    .eq("patient_id", patientId);
  if (visitsError) {
    return { error: `Could not delete visits: ${visitsError.message}` };
  }

  const { error: patientError } = await serviceRole.from("patients").delete().eq("id", patientId);
  if (patientError) {
    return { error: `Could not delete the patient: ${patientError.message}` };
  }

  revalidatePath(`/admin/hospitals/${patient.hospital_id}/patients`);
  return {};
}
