"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole, requireActiveTenant, AuthError } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log";
import type { ModuleType, DocumentScope } from "@/types/database";

const SETTINGS_PATH = "/dashboard/settings";

export async function enableModule(module: ModuleType): Promise<{ error?: string }> {
  const profile = requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();
  const { error } = await supabase
    .from("hospital_modules")
    .insert({ hospital_id: profile.hospitalId!, module });

  if (error) {
    return { error: "Could not enable that module." };
  }

  await logAudit({
    action: "module.enabled",
    targetType: "hospital_modules",
    metadata: { module },
  });
  revalidatePath(SETTINGS_PATH);
  return {};
}

export async function disableModule(module: ModuleType): Promise<{ error?: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();
  const { error } = await supabase.from("hospital_modules").delete().eq("module", module);

  if (error) {
    return { error: "Could not disable that module." };
  }

  await logAudit({
    action: "module.disabled",
    targetType: "hospital_modules",
    metadata: { module },
  });
  revalidatePath(SETTINGS_PATH);
  return {};
}

export interface VisitTypeFormState {
  error?: string;
}

export async function createVisitType(
  _prevState: VisitTypeFormState,
  formData: FormData,
): Promise<VisitTypeFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));
  return upsertVisitType(null, formData);
}

export async function updateVisitType(
  visitTypeId: string,
  _prevState: VisitTypeFormState,
  formData: FormData,
): Promise<VisitTypeFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));
  return upsertVisitType(visitTypeId, formData);
}

async function upsertVisitType(
  visitTypeId: string | null,
  formData: FormData,
): Promise<VisitTypeFormState> {
  const visitTypeModule = String(formData.get("module") ?? "") as ModuleType;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const defaultFeeRaw = String(formData.get("defaultFee") ?? "").trim();
  const defaultFee = defaultFeeRaw ? Number(defaultFeeRaw) : null;
  const active = formData.get("active") === "on";

  if (!name) {
    return { error: "Enter a name." };
  }
  if (visitTypeModule !== "GENERAL_OPD" && visitTypeModule !== "USG") {
    return { error: "Choose a module." };
  }
  if (defaultFee !== null && (Number.isNaN(defaultFee) || defaultFee < 0)) {
    return { error: "Default fee must be a positive number." };
  }

  const supabase = await createClient();
  const values = { module: visitTypeModule, name, description, default_fee: defaultFee, active };
  const { error } = visitTypeId
    ? await supabase.from("visit_types").update(values).eq("id", visitTypeId)
    : await supabase.from("visit_types").insert(values);

  if (error) {
    return { error: "Could not save that visit type." };
  }

  await logAudit({
    action: visitTypeId ? "visit_type.updated" : "visit_type.created",
    targetType: "visit_type",
    targetId: visitTypeId ?? undefined,
  });
  revalidatePath(SETTINGS_PATH);
  return {};
}

export interface DoctorFormState {
  error?: string;
}

export async function createDoctor(
  _prevState: DoctorFormState,
  formData: FormData,
): Promise<DoctorFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Enter a name." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("doctors").insert({ name });

  if (error) {
    return { error: "Could not add that doctor." };
  }

  await logAudit({ action: "doctor.created", targetType: "doctor" });
  revalidatePath(SETTINGS_PATH);
  return {};
}

// Returns void (throws on failure) rather than {error?} so this can be
// bound directly as a <form action={...}>, same as setStaffStatus.
export async function setDoctorStatus(doctorId: string, active: boolean): Promise<void> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();
  const { error } = await supabase.from("doctors").update({ active }).eq("id", doctorId);

  if (error) {
    throw new AuthError("Could not update that doctor.", 403);
  }

  await logAudit({
    action: "doctor.status_changed",
    targetType: "doctor",
    targetId: doctorId,
    metadata: { active },
  });
  revalidatePath(SETTINGS_PATH);
}

export interface DocumentTypeFormState {
  error?: string;
}

export async function createDocumentType(
  _prevState: DocumentTypeFormState,
  formData: FormData,
): Promise<DocumentTypeFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const scope = String(formData.get("scope") ?? "") as DocumentScope;
  const sensitive = formData.get("sensitive") === "on";
  const pcPndtForm = formData.get("pcPndtForm") === "on";
  const requiresSignature = formData.get("requiresSignature") === "on";

  if (!name) {
    return { error: "Enter a name." };
  }
  if (scope !== "PATIENT" && scope !== "VISIT") {
    return { error: "Choose a scope." };
  }

  const supabase = await createClient();

  // Creating a document type with the same name as an existing one is
  // treated as superseding it with a new version (per document_types'
  // own version/effective_from columns, unused since Phase 4 for
  // exactly this) -- the version number is always server-derived,
  // never trusted from the client.
  const { data: priorVersions } = await supabase
    .from("document_types")
    .select("id, version")
    .eq("name", name);
  const nextVersion =
    priorVersions && priorVersions.length > 0
      ? Math.max(...priorVersions.map((v) => v.version)) + 1
      : 1;

  const { error } = await supabase.from("document_types").insert({
    name,
    description,
    scope,
    sensitive,
    pc_pndt_form: pcPndtForm,
    requires_signature: requiresSignature,
    version: nextVersion,
    effective_from: new Date().toISOString().slice(0, 10),
  });

  if (error) {
    return { error: "Could not save that document type." };
  }

  if (priorVersions && priorVersions.length > 0) {
    await supabase
      .from("document_types")
      .update({ active: false })
      .in(
        "id",
        priorVersions.map((v) => v.id),
      );
  }

  await logAudit({
    action: "document_type.created",
    targetType: "document_type",
    metadata: { name, version: nextVersion, superseded: priorVersions?.length ?? 0 },
  });
  revalidatePath(SETTINGS_PATH);
  return {};
}

export async function updateDocumentType(
  documentTypeId: string,
  _prevState: DocumentTypeFormState,
  formData: FormData,
): Promise<DocumentTypeFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const sensitive = formData.get("sensitive") === "on";
  const pcPndtForm = formData.get("pcPndtForm") === "on";
  const requiresSignature = formData.get("requiresSignature") === "on";
  const active = formData.get("active") === "on";

  if (!name) {
    return { error: "Enter a name." };
  }

  // scope is intentionally not editable here: changing PATIENT<->VISIT
  // on a type already attached to real documents would be a data-
  // integrity trap, not a simple field edit. version/effective_from
  // are likewise not editable in place -- create a new document type
  // with the same name instead, which supersedes this one as a new
  // version (see createDocumentType).
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_types")
    .update({
      name,
      description,
      sensitive,
      pc_pndt_form: pcPndtForm,
      requires_signature: requiresSignature,
      active,
    })
    .eq("id", documentTypeId);

  if (error) {
    return { error: "Could not save that document type." };
  }

  await logAudit({
    action: "document_type.updated",
    targetType: "document_type",
    targetId: documentTypeId,
  });
  revalidatePath(SETTINGS_PATH);
  return {};
}

export async function setRequirement(
  visitTypeId: string,
  documentTypeId: string,
  required: boolean | null,
): Promise<{ error?: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();

  if (required === null) {
    const { error } = await supabase
      .from("visit_type_document_requirements")
      .delete()
      .eq("visit_type_id", visitTypeId)
      .eq("document_type_id", documentTypeId);
    if (error) return { error: "Could not update that requirement." };
  } else {
    const { data: existing } = await supabase
      .from("visit_type_document_requirements")
      .select("id")
      .eq("visit_type_id", visitTypeId)
      .eq("document_type_id", documentTypeId)
      .maybeSingle();

    const { error } = existing
      ? await supabase
          .from("visit_type_document_requirements")
          .update({ required })
          .eq("id", existing.id)
      : await supabase
          .from("visit_type_document_requirements")
          .insert({ visit_type_id: visitTypeId, document_type_id: documentTypeId, required });
    if (error) return { error: "Could not update that requirement." };
  }

  await logAudit({
    action: "visit_type_document_requirement.updated",
    targetType: "visit_type",
    targetId: visitTypeId,
    metadata: { document_type_id: documentTypeId, required },
  });
  revalidatePath(SETTINGS_PATH);
  return {};
}
