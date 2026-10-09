"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole, requireActiveTenant, AuthError } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log";
import { validateLmp } from "@/lib/visits/lmp";
import { todayInAppTimezone } from "@/lib/visits/today";
import type { PaymentMode, VisitStatus } from "@/types/database";

export interface CreateVisitState {
  error?: string;
}

export async function createVisit(
  patientId: string,
  _prevState: CreateVisitState,
  formData: FormData,
): Promise<CreateVisitState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]));

  const visitTypeId = String(formData.get("visitTypeId") ?? "").trim();
  if (!visitTypeId) {
    return { error: "Choose a visit type." };
  }
  const doctorId = String(formData.get("doctorId") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const referredByName = String(formData.get("referredByName") ?? "").trim() || null;
  const referredByHospital = String(formData.get("referredByHospital") ?? "").trim() || null;
  const feeAmountRaw = String(formData.get("feeAmount") ?? "").trim();
  const feeAmount = feeAmountRaw ? Number(feeAmountRaw) : 0;
  const followUpDate = String(formData.get("followUpDate") ?? "").trim() || null;

  if (Number.isNaN(feeAmount) || feeAmount < 0) {
    return { error: "Fee must be a positive number." };
  }

  // A new visit is dated today (India time, the database's own default).
  const lmp = validateLmp(String(formData.get("lmpDate") ?? ""), todayInAppTimezone());
  if ("error" in lmp) {
    return { error: lmp.error };
  }

  const supabase = await createClient();
  const { data: visit, error } = await supabase
    .from("visits")
    .insert({
      patient_id: patientId,
      visit_type_id: visitTypeId,
      doctor_id: doctorId,
      notes,
      referred_by_name: referredByName,
      referred_by_hospital: referredByHospital,
      fee_amount: feeAmount,
      follow_up_date: followUpDate,
      lmp_date: lmp.value,
    })
    .select("id")
    .single();

  if (error || !visit) {
    return { error: "Could not create the visit. Try again." };
  }

  // Document requirements are snapshotted onto visit_document_requirements
  // by a database trigger (visits_snapshot_document_requirements, see
  // the Phase 4 migration) — not here — so it happens for every
  // insert into `visits` regardless of which code path creates the
  // row, not just this one.

  await logAudit({ action: "visit.created", targetType: "visit", targetId: visit.id });

  redirect(`/dashboard/visits/${visit.id}`);
}

export interface RecordPaymentState {
  error?: string;
}

export async function recordPayment(
  visitId: string,
  _prevState: RecordPaymentState,
  formData: FormData,
): Promise<RecordPaymentState> {
  const profile = requireActiveTenant(
    requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]),
  );

  const isReversal = formData.get("isReversal") === "true";
  if (isReversal && profile.role !== "HOSPITAL_ADMIN") {
    throw new AuthError("Only an admin can record a reversal.", 403);
  }

  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amount = amountRaw ? Number(amountRaw) : NaN;
  const mode = String(formData.get("mode") ?? "").trim() as PaymentMode;
  const note = String(formData.get("note") ?? "").trim() || null;
  const referenceNumber = String(formData.get("referenceNumber") ?? "").trim() || null;

  if (Number.isNaN(amount) || amount === 0) {
    return { error: "Enter a non-zero amount." };
  }
  if (!(["CASH", "UPI", "CARD", "OTHER"] as const).includes(mode)) {
    return { error: "Choose a payment mode." };
  }
  if (isReversal && amount > 0) {
    return { error: "A reversal amount must be negative." };
  }
  if (!isReversal && amount < 0) {
    return { error: "Amount must be positive." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("visit_payments").insert({
    visit_id: visitId,
    amount,
    mode,
    note,
    reference_number: referenceNumber,
    is_reversal: isReversal,
  });

  if (error) {
    return { error: "Could not record the payment. Try again." };
  }

  await logAudit({
    action: isReversal ? "payment.reversed" : "payment.recorded",
    targetType: "visit",
    targetId: visitId,
    metadata: { amount, mode },
  });

  revalidatePath(`/dashboard/visits/${visitId}`);
  return {};
}

const FORWARD_TRANSITIONS: Record<VisitStatus, VisitStatus | null> = {
  SCHEDULED: "IN_PROGRESS",
  IN_PROGRESS: "COMPLETED",
  COMPLETED: null,
  CANCELLED: null,
};

export async function setVisitExaminationStatus(
  visitId: string,
  nextStatus: "IN_PROGRESS" | "COMPLETED",
): Promise<{ error?: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]));

  const supabase = await createClient();
  const { data: visit } = await supabase
    .from("visits")
    .select("status")
    .eq("id", visitId)
    .maybeSingle();
  if (!visit) {
    return { error: "Visit not found." };
  }

  // Forward-only: a visit can only move to the next stage in its own
  // sequence, never skip ahead or move backward, and never leave
  // COMPLETED/CANCELLED. No exception for who's asking — the sequence
  // itself is the guard, not a role check.
  if (FORWARD_TRANSITIONS[visit.status] !== nextStatus) {
    return {
      error: `Cannot move a ${visit.status.toLowerCase()} visit to ${nextStatus.toLowerCase()}.`,
    };
  }

  const { error } = await supabase.from("visits").update({ status: nextStatus }).eq("id", visitId);
  if (error) {
    return { error: "Could not update the visit status." };
  }

  await logAudit({
    action: "visit.status_changed",
    targetType: "visit",
    targetId: visitId,
    metadata: { status: nextStatus },
  });

  revalidatePath(`/dashboard/visits/${visitId}`);
  revalidatePath("/dashboard/usg");
  return {};
}

export interface UpdateLmpState {
  error?: string;
  saved?: boolean;
}

/**
 * Sets (or clears) a visit's last menstrual period after the fact -- it is
 * often not known at the desk and added when the patient is in with the
 * doctor. The weeks of pregnancy printed on forms are worked out from it.
 */
export async function updateVisitLmp(
  visitId: string,
  _prevState: UpdateLmpState,
  formData: FormData,
): Promise<UpdateLmpState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]));

  const supabase = await createClient();
  const { data: visit } = await supabase
    .from("visits")
    .select("visit_date")
    .eq("id", visitId)
    .maybeSingle();
  if (!visit) {
    return { error: "Visit not found." };
  }

  const lmp = validateLmp(String(formData.get("lmpDate") ?? ""), visit.visit_date);
  if ("error" in lmp) {
    return { error: lmp.error };
  }

  const { error } = await supabase.from("visits").update({ lmp_date: lmp.value }).eq("id", visitId);
  if (error) {
    return { error: "Could not save the LMP. Try again." };
  }

  await logAudit({ action: "visit.lmp_updated", targetType: "visit", targetId: visitId });
  revalidatePath(`/dashboard/visits/${visitId}`);
  return { saved: true };
}
