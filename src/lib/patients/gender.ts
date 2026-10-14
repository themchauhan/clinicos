import type { PatientGender } from "@/types/database";

/**
 * Pregnancy-related questions (children, LMP) are only asked for a patient
 * who could be pregnant. A patient recorded as male never sees them; one
 * with no gender recorded still does, since a missing value says nothing.
 */
export function asksPregnancyDetails(gender: PatientGender | null | undefined): boolean {
  return gender !== "MALE";
}
