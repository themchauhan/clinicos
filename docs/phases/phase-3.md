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

## Manual test steps — later additions

Run once against a local instance:

- **Patient form:** `/dashboard/patients/new` fits one screen; pick
  Relationship "W/O" + a guardian name, save; the profile and list show
  "W/O <name>"; relationship without a name is rejected.
- **Patients list:** opens on Today; "All patients" lists everyone;
  searching from either tab finds patients registered earlier.
- **Visits list:** Today / Past / All tabs each show the right set.
- **Patient ID prefix:** a new patient gets `<PREFIX>NNN`; as platform
  admin change a centre's prefix once (existing IDs relabel), the field
  then shows as locked.
- **Required forms:** Settings → Forms → mark a form Required for a USG
  visit type; create a new visit of that type: the form shows
  "Required — not filled" above the upload row, the visit counts as
  Documents pending (dashboard, USG board, Pending documents); sign the
  form and it clears. A female patient on a USG visit shows the hint.
- **Children & LMP:** on a patient form, open "Children" and enter sons /
  daughters with ages; the profile shows them. On a new USG visit enter
  the LMP; the visit page shows "N weeks of pregnancy"; a future LMP is
  refused.
- **Form F:** Settings → Forms → New: upload the 5-page Form F PDF, press
  "Use the standard Form F layout", save. On a USG visit press Fill: the
  children, referrer, LMP/weeks, centre and doctor are pre-filled;
  result / conveyed-to / MTP are empty; tick some indications and sign;
  the PDF shows ticks beside those items and the doctor's seal and
  signature on pages 3 and 4.
