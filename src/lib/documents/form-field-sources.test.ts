import { describe, expect, it } from "vitest";
import {
  resolveKnownFieldValue,
  type PatientFieldSource,
  type HospitalFieldSource,
  type DoctorFieldSource,
  type VisitFieldSource,
} from "./form-field-sources";

const patient: PatientFieldSource = {
  name: "Test Patient",
  guardianName: "Test Guardian",
  guardianRelation: "W/O",
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

  it("resolves the guardian relationship alone and combined with the name", () => {
    const ctx = { patient, hospital, doctor };
    expect(resolveKnownFieldValue("patient.guardian_relation", ctx)).toBe("W/O");
    expect(resolveKnownFieldValue("patient.guardian_full", ctx)).toBe("W/O Test Guardian");
    // The existing name-only key is unchanged, so older templates keep working.
    expect(resolveKnownFieldValue("patient.guardian_name", ctx)).toBe("Test Guardian");
  });

  it("falls back gracefully when no relationship or guardian is on file", () => {
    const noRelation = { ...patient, guardianRelation: null };
    expect(
      resolveKnownFieldValue("patient.guardian_full", { patient: noRelation, hospital, doctor }),
    ).toBe("Test Guardian");
    expect(
      resolveKnownFieldValue("patient.guardian_relation", {
        patient: noRelation,
        hospital,
        doctor,
      }),
    ).toBe("");
    const noGuardian = { ...patient, guardianName: null, guardianRelation: null };
    expect(
      resolveKnownFieldValue("patient.guardian_full", { patient: noGuardian, hospital, doctor }),
    ).toBe("");
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
    const overridden: HospitalFieldSource = {
      ...hospital,
      centreName: "Genetic Clinic Trade Name",
    };
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
    expect(resolveKnownFieldValue("address", { patient, hospital, doctor })).toBe(
      "123 Test Street",
    );
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

  describe("visit and Form F sources", () => {
    const visit: VisitFieldSource = {
      date: "2026-10-09",
      typeName: "Pregnancy/Obstetric USG",
      module: "USG",
      referredByName: "Dr Test Referrer",
      referredByHospital: "Test Referral Clinic",
      lmpDate: "2026-06-01",
    };
    const ctx = { patient, hospital, doctor, visit };

    it("resolves the visit's date, type and referrer", () => {
      expect(resolveKnownFieldValue("visit.date", ctx)).toBe("2026-10-09");
      expect(resolveKnownFieldValue("visit.type_name", ctx)).toBe("Pregnancy/Obstetric USG");
      expect(resolveKnownFieldValue("visit.referred_by", ctx)).toBe(
        "Dr Test Referrer, Test Referral Clinic",
      );
      expect(resolveKnownFieldValue("visit.referred_by_name", ctx)).toBe("Dr Test Referrer");
      expect(resolveKnownFieldValue("visit.referred_by_hospital", ctx)).toBe(
        "Test Referral Clinic",
      );
    });

    it("joins only the referrer parts that exist", () => {
      const onlyName = { ...ctx, visit: { ...visit, referredByHospital: null } };
      expect(resolveKnownFieldValue("visit.referred_by", onlyName)).toBe("Dr Test Referrer");
      const none = { ...ctx, visit: { ...visit, referredByName: null, referredByHospital: " " } };
      expect(resolveKnownFieldValue("visit.referred_by", none)).toBe("");
    });

    it("works out the weeks of pregnancy from the LMP and the visit date", () => {
      expect(resolveKnownFieldValue("visit.lmp_date", ctx)).toBe("2026-06-01");
      expect(resolveKnownFieldValue("visit.gestational_age", ctx)).toBe("18 weeks 4 days");
      const noLmp = { ...ctx, visit: { ...visit, lmpDate: null } };
      expect(resolveKnownFieldValue("visit.gestational_age", noLmp)).toBe("");
    });

    it("gives the LMP and the weeks of pregnancy together, or just the date, or nothing", () => {
      expect(resolveKnownFieldValue("visit.lmp_with_weeks", ctx)).toBe(
        "01/06/2026, 18 weeks 4 days",
      );
      // An LMP after the visit date has no weeks: the date alone is still shown.
      const odd = { ...ctx, visit: { ...visit, date: "2026-05-01" } };
      expect(resolveKnownFieldValue("visit.lmp_with_weeks", odd)).toBe("01/06/2026");
      const none = { ...ctx, visit: { ...visit, lmpDate: null } };
      expect(resolveKnownFieldValue("visit.lmp_with_weeks", none)).toBe("");
    });

    it("ticks for an ultrasound visit only", () => {
      expect(resolveKnownFieldValue("visit.is_usg", ctx)).toBe("1");
      const opd = { ...ctx, visit: { ...visit, module: "GENERAL_OPD" as const } };
      expect(resolveKnownFieldValue("visit.is_usg", opd)).toBe("");
    });

    it("is blank, not an error, when the form is filled without a visit", () => {
      const noVisit = { patient, hospital, doctor };
      for (const key of [
        "visit.date",
        "visit.type_name",
        "visit.referred_by",
        "visit.gestational_age",
        "visit.is_usg",
      ]) {
        expect(resolveKnownFieldValue(key, noVisit)).toBe("");
      }
    });

    it("resolves a repeated visit source (#2) like the first", () => {
      expect(resolveKnownFieldValue("visit.date#2", ctx)).toBe("2026-10-09");
    });
  });

  describe("children, contact and relationship sources", () => {
    const withKids = {
      ...patient,
      guardianRelation: "W/O",
      livingSons: 1,
      livingSonsAges: "6 years",
      livingDaughters: 2,
      livingDaughtersAges: "4 years, 8 months",
    };
    const ctx = { patient: withKids, hospital, doctor };

    it("resolves the children's counts, total and ages", () => {
      expect(resolveKnownFieldValue("patient.sons_count", ctx)).toBe("1");
      expect(resolveKnownFieldValue("patient.sons_ages", ctx)).toBe("6 years");
      expect(resolveKnownFieldValue("patient.daughters_count", ctx)).toBe("2");
      expect(resolveKnownFieldValue("patient.daughters_ages", ctx)).toBe("4 years, 8 months");
      expect(resolveKnownFieldValue("patient.children_total", ctx)).toBe("3");
    });

    it("leaves everything blank when children were never recorded, and counts one-sided entries", () => {
      expect(resolveKnownFieldValue("patient.children_total", { patient, hospital, doctor })).toBe(
        "",
      );
      expect(resolveKnownFieldValue("patient.sons_count", { patient, hospital, doctor })).toBe("");
      const onlyDaughters = { ...ctx, patient: { ...withKids, livingSons: null } };
      expect(resolveKnownFieldValue("patient.children_total", onlyDaughters)).toBe("2");
    });

    it("gives address and mobile together, and the guardian's role in words", () => {
      expect(resolveKnownFieldValue("patient.contact", ctx)).toBe(
        "123 Test Street, Mobile: 9999999999",
      );
      const noMobile = { ...ctx, patient: { ...withKids, mobile: null } };
      expect(resolveKnownFieldValue("patient.contact", noMobile)).toBe("123 Test Street");

      expect(resolveKnownFieldValue("patient.guardian_relationship", ctx)).toBe("Husband");
      for (const [relation, word] of [
        ["S/O", "Father"],
        ["D/O", "Father"],
        ["H/O", "Wife"],
        ["C/O", "Relative"],
        [null, ""],
      ] as const) {
        const c = { ...ctx, patient: { ...withKids, guardianRelation: relation } };
        expect(resolveKnownFieldValue("patient.guardian_relationship", c)).toBe(word);
      }
    });
  });
});
