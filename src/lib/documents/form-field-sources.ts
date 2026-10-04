import { ageInYears } from "@/lib/patients/age";
import { formatGuardian } from "@/lib/patients/guardian";
import type { PatientGender } from "@/types/database";

/**
 * Known field-key strings a form template field can be sourced from,
 * so staff never retype what's already on file -- offered as a
 * dropdown in the designer (form-template-designer.tsx) instead of a
 * freeform key, and resolved to an actual value here when a visit's
 * FormFillPanel pre-fills its fields. A field_key outside this list is
 * still perfectly valid -- it just stays blank, typed fresh each visit
 * (the right behavior for genuinely per-visit facts like "indication
 * for procedure" or "referring doctor").
 */
export const PATIENT_FIELD_OPTIONS = [
  { key: "patient.name", label: "Patient name" },
  { key: "patient.guardian_name", label: "Guardian / husband / father's name" },
  { key: "patient.guardian_relation", label: "Guardian relationship (S/O, D/O, W/O…)" },
  { key: "patient.guardian_full", label: "Guardian with relationship (e.g. W/O Anand)" },
  { key: "patient.address", label: "Patient address" },
  { key: "patient.mobile", label: "Patient mobile" },
  { key: "patient.age", label: "Patient age" },
  { key: "patient.gender", label: "Patient gender" },
] as const;

export const HOSPITAL_FIELD_OPTIONS = [
  { key: "hospital.centre_name", label: "Centre name" },
  { key: "hospital.centre_address", label: "Centre address" },
  { key: "hospital.registration_no", label: "PC&PNDT registration number" },
] as const;

export const DOCTOR_FIELD_OPTIONS = [
  { key: "doctor.name", label: "Doctor name" },
  { key: "doctor.registration_no", label: "Doctor registration number" },
] as const;

/** Not tied to patient/hospital/doctor records -- just today's date,
 * computed fresh every time the form is opened to fill. */
export const OTHER_FIELD_OPTIONS = [{ key: "system.today", label: "Today's date" }] as const;

/** Local calendar date (not UTC) in the yyyy-mm-dd shape an
 * `<input type="date">` expects. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export interface PatientFieldSource {
  name: string;
  guardianName: string | null;
  guardianRelation: string | null;
  address: string | null;
  mobile: string | null;
  dob: string | null;
  approximateAgeYears: number | null;
  gender: PatientGender | null;
}

export interface HospitalFieldSource {
  name: string;
  address: string | null;
  centreName: string | null;
  centreAddress: string | null;
  registrationNo: string | null;
}

/** Sourced from the visit's already-assigned doctor -- not a separate
 * picker. Both fields resolve to "" (staff can still type them by
 * hand) when the visit has no doctor assigned yet. */
export interface DoctorFieldSource {
  name: string | null;
  registrationNo: string | null;
}

/** Returns undefined for a field_key this registry doesn't recognize,
 * so the caller knows to leave it as freeform, staff-typed input. */
export function resolveKnownFieldValue(
  fieldKey: string,
  ctx: { patient: PatientFieldSource; hospital: HospitalFieldSource; doctor: DoctorFieldSource },
): string | undefined {
  // A known source placed more than once on the same template gets a
  // disambiguating "#2", "#3", ... suffix to satisfy the field_key
  // uniqueness constraint (see uniqueFieldKey in
  // form-template-designer.tsx) -- strip it back off before matching,
  // so every copy still resolves the same way.
  const baseKey = fieldKey.replace(/#\d+$/, "");
  switch (baseKey) {
    case "patient.name":
    // Legacy keys from before this registry existed -- kept so form
    // templates created under the old freeform field-key input keep
    // pre-filling exactly as before.
    case "patient_name":
      return ctx.patient.name;
    case "patient.guardian_name":
    case "guardian_name":
    case "husband_or_father_name":
      return ctx.patient.guardianName ?? "";
    case "patient.guardian_relation":
      return ctx.patient.guardianRelation ?? "";
    case "patient.guardian_full":
      return ctx.patient.guardianName
        ? formatGuardian(ctx.patient.guardianRelation, ctx.patient.guardianName)
        : "";
    case "patient.address":
    case "address":
      return ctx.patient.address ?? "";
    case "patient.mobile":
      return ctx.patient.mobile ?? "";
    case "patient.age":
      return ageInYears(ctx.patient.dob, ctx.patient.approximateAgeYears);
    case "patient.gender":
      return ctx.patient.gender ?? "";
    case "hospital.centre_name":
      return ctx.hospital.centreName ?? ctx.hospital.name;
    case "hospital.centre_address":
      return ctx.hospital.centreAddress ?? ctx.hospital.address ?? "";
    case "hospital.registration_no":
      return ctx.hospital.registrationNo ?? "";
    case "doctor.name":
      return ctx.doctor.name ?? "";
    case "doctor.registration_no":
      return ctx.doctor.registrationNo ?? "";
    case "system.today":
      return todayIso();
    default:
      return undefined;
  }
}
