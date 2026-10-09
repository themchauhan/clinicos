"use server";

import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole, requireActiveTenant } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log";
import type { PatientGender } from "@/types/database";
import { parseChildren } from "@/lib/patients/children";
import { isGuardianRelation, type GuardianRelation } from "@/lib/patients/guardian";

// Digits only, with an optional leading "+" for a country code --
// strict enough to reject non-numeric input like "abcd" while still
// accepting a plain 10-digit Indian mobile or an internationally
// prefixed one (e.g. +919876500099).
const MOBILE_PATTERN = /^\+?[0-9]{7,15}$/;

interface PatientFields {
  name: string;
  mobile: string | null;
  dob: string | null;
  approximateAgeYears: number | null;
  guardianName: string | null;
  guardianRelation: GuardianRelation | null;
  gender: PatientGender | null;
  address: string | null;
  livingSons: number | null;
  livingSonsAges: string | null;
  livingDaughters: number | null;
  livingDaughtersAges: string | null;
}

export interface PatientFormState {
  error?: string;
  duplicates?: {
    id: string;
    name: string;
    patient_code: string;
    mobile: string | null;
    dob: string | null;
  }[];
  // Whatever was actually submitted, echoed back so the form can
  // restore it after a round-trip (e.g. the duplicate-check step)
  // instead of the uncontrolled inputs resetting to their original
  // (usually empty) defaultValue.
  values?: PatientFields;
}

function readPatientFields(formData: FormData): PatientFields | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Enter the patient's name." };
  }

  // Strip spaces/hyphens/parens so "98765 00099" and "98765-00099"
  // store (and duplicate-match) identically, then validate what's left.
  const mobileRaw = String(formData.get("mobile") ?? "")
    .trim()
    .replace(/[\s\-()]/g, "");
  const mobile = mobileRaw || null;
  if (mobile && !MOBILE_PATTERN.test(mobile)) {
    return { error: "Enter a valid mobile number (digits only)." };
  }
  const dob = String(formData.get("dob") ?? "").trim() || null;
  const approximateAgeYearsRaw = String(formData.get("approximateAgeYears") ?? "").trim();
  const approximateAgeYears = approximateAgeYearsRaw ? Number(approximateAgeYearsRaw) : null;
  const guardianName = String(formData.get("guardianName") ?? "").trim() || null;
  const guardianRelationRaw = String(formData.get("guardianRelation") ?? "").trim();
  const guardianRelation = isGuardianRelation(guardianRelationRaw) ? guardianRelationRaw : null;
  const genderRaw = String(formData.get("gender") ?? "").trim();
  const gender = (["MALE", "FEMALE", "OTHER"] as const).includes(genderRaw as PatientGender)
    ? (genderRaw as PatientGender)
    : null;
  const address = String(formData.get("address") ?? "").trim() || null;

  if (guardianRelation && !guardianName) {
    return { error: "Enter the guardian's name, or clear the relationship." };
  }
  if (dob && approximateAgeYears) {
    return { error: "Enter either a date of birth or an approximate age, not both." };
  }
  if (
    approximateAgeYears !== null &&
    (Number.isNaN(approximateAgeYears) || approximateAgeYears < 0)
  ) {
    return { error: "Approximate age must be a positive number." };
  }

  const children = parseChildren((key) => String(formData.get(key) ?? ""));
  if ("error" in children) {
    return { error: children.error };
  }

  return {
    name,
    mobile,
    dob,
    approximateAgeYears,
    guardianName,
    guardianRelation,
    gender,
    address,
    ...children.children,
  };
}

export async function createPatient(
  _prevState: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const profile = requireActiveTenant(
    requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]),
  );

  const fields = readPatientFields(formData);
  if ("error" in fields) {
    return { error: fields.error };
  }

  const supabase = await createClient();
  const confirmed = formData.get("confirmed") === "true";

  if (!confirmed) {
    const { data: duplicates, error: duplicateError } = await supabase.rpc(
      "possible_duplicate_patients",
      { p_name: fields.name, p_mobile: fields.mobile, p_dob: fields.dob },
    );
    if (!duplicateError && duplicates && duplicates.length > 0) {
      return {
        values: fields,
        duplicates: duplicates.map((d) => ({
          id: d.id,
          name: d.name,
          patient_code: d.patient_code,
          mobile: d.mobile,
          dob: d.dob,
        })),
      };
    }
  }

  const { data: created, error } = await supabase
    .from("patients")
    .insert({
      name: fields.name,
      mobile: fields.mobile,
      dob: fields.dob,
      approximate_age_years: fields.approximateAgeYears,
      guardian_name: fields.guardianName,
      guardian_relation: fields.guardianRelation,
      living_sons: fields.livingSons,
      living_sons_ages: fields.livingSonsAges,
      living_daughters: fields.livingDaughters,
      living_daughters_ages: fields.livingDaughtersAges,
      gender: fields.gender,
      address: fields.address,
    })
    .select("id")
    .single();

  if (error || !created) {
    return { error: "Could not create the patient. Try again.", values: fields };
  }

  await logAudit({
    action: "patient.created",
    targetType: "patient",
    targetId: created.id,
    metadata: { hospital_id: profile.hospitalId },
  });

  redirect(`/dashboard/patients/${created.id}`);
}

export async function updatePatient(
  patientId: string,
  _prevState: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]));

  const fields = readPatientFields(formData);
  if ("error" in fields) {
    return { error: fields.error };
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("patients")
    .update({
      name: fields.name,
      mobile: fields.mobile,
      dob: fields.dob,
      approximate_age_years: fields.approximateAgeYears,
      guardian_name: fields.guardianName,
      guardian_relation: fields.guardianRelation,
      living_sons: fields.livingSons,
      living_sons_ages: fields.livingSonsAges,
      living_daughters: fields.livingDaughters,
      living_daughters_ages: fields.livingDaughtersAges,
      gender: fields.gender,
      address: fields.address,
    })
    .eq("id", patientId)
    .select("id")
    .single();

  if (error || !updated) {
    return { error: "Could not update the patient. Try again.", values: fields };
  }

  await logAudit({ action: "patient.updated", targetType: "patient", targetId: patientId });

  redirect(`/dashboard/patients/${patientId}`);
}
