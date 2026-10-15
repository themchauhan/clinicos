"use server";

import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole, requireActiveTenant } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log";
import { parsePatientFields, type PatientFields } from "@/lib/patients/parse";

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
  return parsePatientFields((key) => String(formData.get(key) ?? ""));
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
