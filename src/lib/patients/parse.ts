import type { PatientGender } from "@/types/database";
import { parseChildren } from "@/lib/patients/children";
import { isGuardianRelation, type GuardianRelation } from "@/lib/patients/guardian";

/**
 * Reads and checks the patient fields from any source via `get(name)` (the
 * online form, or an offline registration). The ONE place these rules live, so
 * the online form, the offline form and the tests all agree.
 */

// Digits only, with an optional leading "+" for a country code --
// strict enough to reject non-numeric input like "abcd" while still
// accepting a plain 10-digit Indian mobile or an internationally
// prefixed one (e.g. +919876500099).
const MOBILE_PATTERN = /^\+?[0-9]{7,15}$/;

export interface PatientFields {
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

export function parsePatientFields(
  get: (name: string) => string,
): PatientFields | { error: string } {
  const name = get("name").trim();
  if (!name) {
    return { error: "Enter the patient's name." };
  }

  // Strip spaces/hyphens/parens so "98765 00099" and "98765-00099"
  // store (and duplicate-match) identically, then validate what's left.
  const mobileRaw = get("mobile")
    .trim()
    .replace(/[\s\-()]/g, "");
  const mobile = mobileRaw || null;
  if (mobile && !MOBILE_PATTERN.test(mobile)) {
    return { error: "Enter a valid mobile number (digits only)." };
  }
  const dob = get("dob").trim() || null;
  const approximateAgeYearsRaw = get("approximateAgeYears").trim();
  const approximateAgeYears = approximateAgeYearsRaw ? Number(approximateAgeYearsRaw) : null;
  const guardianName = get("guardianName").trim() || null;
  const guardianRelationRaw = get("guardianRelation").trim();
  const guardianRelation = isGuardianRelation(guardianRelationRaw) ? guardianRelationRaw : null;
  const genderRaw = get("gender").trim();
  const gender = (["MALE", "FEMALE", "OTHER"] as const).includes(genderRaw as PatientGender)
    ? (genderRaw as PatientGender)
    : null;
  const address = get("address").trim() || null;

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

  const children = parseChildren(get);
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
