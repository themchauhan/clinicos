# Phase 3 — Visits, seeded visit types, payments

## Tasks

- [ ] `visit_types` table, seeded with at least "OPD Consultation"
      (module GENERAL_OPD) — USG visit types are seeded too but full
      configurability comes in Phase 6
- [ ] `doctors` lookup table (name only for now; `profile_id` column
      exists but stays null — no doctor login yet)
- [ ] Create a visit linked to an existing patient: visit_type,
      doctor, date, notes, status, follow_up_date
- [ ] Chronological visit history shown on the patient profile
- [ ] Printable OPD slip: centre header, patient name/code, date,
      doctor, token number (resets daily), blank space for handwriting
- [ ] `visit_payments` table + `visits.fee_amount`
- [ ] Payment entry UI: amount, mode dropdown (CASH/UPI/CARD/OTHER),
      "received in full" shortcut — derive UNPAID/PARTIAL/PAID, don't
      store it directly
- [ ] Receptionists can add payments, not delete them; admin-only
      reversal entries, audit-logged
- [ ] Common visit data model shared across modules — do not build
      separate code paths per hospital type

## Tests

- [ ] Happy path: create, view, list visits; visit always linked to
      the correct patient and hospital
- [ ] Cross-tenant: visit creation rejects a patient_id from another
      hospital even if forged in the request
- [ ] Payment sum vs. fee_amount correctly derives status in all three
      states

## Acceptance criteria

- Create, view, and list visits; visit is always linked to the
  correct patient and hospital
- A visit's payment status is visible and accurate
