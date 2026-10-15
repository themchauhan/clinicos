import type { PatientFields } from "@/lib/patients/parse";
import type { VisitInput } from "@/lib/offline/queue";

/** Synthetic data for tests (never real patients). */
export const SYNTHETIC_PATIENT: PatientFields = {
  name: "Synthetic Patient",
  mobile: null,
  dob: null,
  approximateAgeYears: 30,
  guardianName: null,
  guardianRelation: null,
  gender: "FEMALE",
  address: null,
  livingSons: null,
  livingSonsAges: null,
  livingDaughters: null,
  livingDaughtersAges: null,
};

export const SYNTHETIC_VISIT: VisitInput = {
  visitTypeId: "11111111-1111-4111-8111-111111111111",
  doctorId: null,
  notes: null,
  referredByName: null,
  referredByHospital: null,
  feeAmount: 100,
  followUpDate: null,
  lmpDate: null,
};
