import { describe, expect, it } from "vitest";
import {
  resolveKnownFieldValue,
  type PatientFieldSource,
  type HospitalFieldSource,
  type DoctorFieldSource,
} from "./form-field-sources";

const patient: PatientFieldSource = {
  name: "Test Patient",
  guardianName: "Test Guardian",
  address: "123 Test Street",
  mobile: "9999999999",
  dob: null,
  approximateAgeYears: 30,
  gender: "FEMALE",
};

const hospital: HospitalFieldSource = {
  name: "Sunrise General Hospital",
  address: "Registered Address",
  centreName: null,
  centreAddress: null,
  registrationNo: "PCPNDT-123",
};

const doctor: DoctorFieldSource = {
  name: "Dr. Test Doctor",
  registrationNo: "MCI-12345",
};

const noDoctor: DoctorFieldSource = { name: null, registrationNo: null };

describe("resolveKnownFieldValue", () => {
  it("resolves a known patient field", () => {
    expect(resolveKnownFieldValue("patient.name", { patient, hospital, doctor })).toBe(
      "Test Patient",
    );
    expect(resolveKnownFieldValue("patient.age", { patient, hospital, doctor })).toBe("~30");
  });

  it("resolves a known hospital field, falling back to the hospital's own name/address when unset", () => {
    expect(resolveKnownFieldValue("hospital.centre_name", { patient, hospital, doctor })).toBe(
      "Sunrise General Hospital",
    );
    expect(resolveKnownFieldValue("hospital.registration_no", { patient, hospital, doctor })).toBe(
      "PCPNDT-123",
    );
  });

  it("prefers an explicit hospital_form_profile override over the hospital's own name/address", () => {
    const overridden: HospitalFieldSource = { ...hospital, centreName: "Genetic Clinic Trade Name" };
    expect(
      resolveKnownFieldValue("hospital.centre_name", { patient, hospital: overridden, doctor }),
    ).toBe("Genetic Clinic Trade Name");
  });

  it("resolves a known doctor field from the visit's assigned doctor", () => {
    expect(resolveKnownFieldValue("doctor.name", { patient, hospital, doctor })).toBe(
      "Dr. Test Doctor",
    );
    expect(resolveKnownFieldValue("doctor.registration_no", { patient, hospital, doctor })).toBe(
      "MCI-12345",
    );
  });

  it("resolves doctor fields to an empty string when the visit has no doctor assigned", () => {
    expect(resolveKnownFieldValue("doctor.name", { patient, hospital, doctor: noDoctor })).toBe("");
    expect(
      resolveKnownFieldValue("doctor.registration_no", { patient, hospital, doctor: noDoctor }),
    ).toBe("");
  });

  it("resolves legacy pre-registry field keys the same as their new equivalents", () => {
    expect(resolveKnownFieldValue("patient_name", { patient, hospital, doctor })).toBe(
      "Test Patient",
    );
    expect(resolveKnownFieldValue("guardian_name", { patient, hospital, doctor })).toBe(
      "Test Guardian",
    );
    expect(resolveKnownFieldValue("address", { patient, hospital, doctor })).toBe("123 Test Street");
  });

  it("returns undefined for an unrecognized field key", () => {
    expect(
      resolveKnownFieldValue("referring_doctor", { patient, hospital, doctor }),
    ).toBeUndefined();
  });

  it("resolves today's date in yyyy-mm-dd form (local calendar date), matching what an <input type=date> expects", () => {
    const value = resolveKnownFieldValue("system.today", { patient, hospital, doctor });
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(value).toBe(expected);
  });

  it("resolves a disambiguated repeat of the same source (e.g. 'system.today#2') the same as the first copy", () => {
    const first = resolveKnownFieldValue("system.today", { patient, hospital, doctor });
    const second = resolveKnownFieldValue("system.today#2", { patient, hospital, doctor });
    const third = resolveKnownFieldValue("doctor.name#3", { patient, hospital, doctor });
    expect(second).toBe(first);
    expect(third).toBe("Dr. Test Doctor");
  });
});
