# ClinicOS — Product Brief

_Revised AI coding brief — MVP phases & acceptance criteria_

## Product goal

Build a simple, secure, multi-tenant web app for small Indian
hospitals and diagnostic (USG) centres. Core value: replace daily
photocopying and repeat form-filling. Capture a patient's details and
ID once; reuse them on every visit. Not a hospital ERP — no pharmacy,
inventory, payroll, insurance, or accounting.

The founding insight: these centres already employ 6–7 staff doing
this paperwork by hand, and are wary of "going online." The product
must be at least as simple as paper for staff, while removing the
photocopier entirely.

## Modules, not hospital types

A centre enables one or more modules:

- **GENERAL_OPD** — general outpatient consultations
- **USG** — ultrasound/diagnostic examinations

A hospital can run both. A standalone USG centre runs only USG. The
dashboard, visit types, and document checklists are composed from
whichever modules are enabled — do not hard-code an either/or
`hospital_type`.

## Roles

- **SUPER_ADMIN** — SaaS owner. Create/manage centres, plans,
  trial/expiry, activate/suspend, manually extend subscriptions,
  review payments and audit information.
- **HOSPITAL_ADMIN** — Manage centre profile, staff, patients,
  visits, visit types, document requirements, fees, centre reports.
- **RECEPTIONIST** — Search/register patients, create visits, upload/
  scan documents, record payments received, view permitted history,
  print permitted slips. Cannot manage subscription or see other
  centres.
- **DOCTOR** (post-MVP, read-only) — view a patient's history and
  attached reports. Most doctors in these centres do not operate a
  computer during consultation; do not design any MVP workflow that
  requires it.

## The paper-handling problem (why this product exists)

Two real workflows observed at hospitals:

1. **General OPD:** the doctor writes on paper in the cabin and hands
   it to the patient. If the patient loses that paper, the centre has
   no record at all. Doctors will not type notes during consultation.
2. **USG centre:** the doctor already has separate report-generation
   software and produces a report in the cabin; reception downloads
   and prints it for the patient. We are not replacing that software.

The MVP does not try to get the doctor onto a screen. Instead:

- Reception prints a slip (OPD) before the consultation, with the
  centre header, patient name/code, date, and doctor name already
  filled in, and blank space for the doctor to write.
- After the consultation, reception (or whoever the centre nominates
  — could be the billing desk, a nurse, or the pharmacy counter)
  scans that slip with the phone-camera flow and attaches it to the
  visit as a document.
- For USG, the finished report PDF from the centre's existing
  software is attached to the visit the same way.
- Any visit missing its expected document shows under "Pending
  Documents" so nothing is silently lost — this is the safety net
  that paper alone never had.

The image itself is the source of truth. Do not have staff retype
prescriptions or transcribe clinical content — that creates clinical
risk from transcription errors. Only light metadata is captured:
date, doctor, visit type, optional follow-up date.

## IDs

The centre may accept any ID type (Aadhaar, PAN, voter ID, driving
licence, etc. — configurable per centre, no restriction to non-Aadhaar
in this version). ID documents are patient-level (`scope = PATIENT`):
captured once, reused on every visit, unlike visit-level documents
(`scope = VISIT`) which are expected fresh each time.

Treat ID documents as sensitive:

- Every view is audit-logged (who viewed which patient's ID, when).
- The ID number itself is never stored in a plain, generally
  searchable column — if it's captured as text at all, keep it out of
  full-text search and general list views.
- Access is restricted to roles the centre configures (typically
  RECEPTIONIST and HOSPITAL_ADMIN).

## PC-PNDT / pregnancy-obstetric examinations

For pregnancy/obstetric USG, support centre-configured, current
applicable PC-PNDT documentation and declarations, tracked with a
form version and effective date. Do not build any functionality that
determines or discloses fetal sex. The app does not certify legal
compliance — each centre must validate its required forms and
retention practices with its own qualified legal/compliance guidance.

## Technology and architecture

- Next.js (App Router) + React + TypeScript (strict) + Tailwind CSS
- Supabase initially: Postgres, Auth, private Storage; deploy on
  Vercel. Prefer Mumbai / `bom1` regions where available.
- Next.js server-side routes/actions for all protected operations —
  no separate Express server in the MVP.
- Keep business logic and DB access modular so Postgres could later
  move to another provider.
- Strict multi-tenancy: every tenant-owned row has `hospital_id`,
  derived from the authenticated server-side session — never from a
  browser-supplied value.
- Postgres Row Level Security (RLS), role-based authorization,
  private file storage with short-lived signed URLs, audit logs,
  backups, secure environment variables.
- The Supabase service-role key never appears in client-reachable
  code; confine it to one server-only module for platform-admin
  provisioning. All tenant reads/writes go through the user's own
  session so RLS actually applies.
- No plaintext passwords, no parallel password system.
- Soft-delete only (`deleted_at`) for patients, visits, documents —
  never a hard `DELETE` on clinical data.

## Core data model (initial)

| Table                              | Key fields                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hospitals`                        | id, name, address, phone, email, status, plan, trial_ends_at, subscription_ends_at, created_at, updated_at                                                                                                                  |
| `hospital_modules`                 | id, hospital_id, module (`GENERAL_OPD` \| `USG`), enabled_at                                                                                                                                                                |
| `profiles`                         | id (Auth user), hospital_id (nullable only via a separate `platform_admins` check, never a bare nullable "trust me" column), name, email, role, status, created_at                                                          |
| `patients`                         | id, hospital_id, patient_code (unique per hospital, generated from a per-hospital counter row, not `max()+1`), name, mobile, dob (nullable — allow approximate age), guardian_name, gender, address, created_at, updated_at |
| `doctors`                          | id, hospital_id, name, profile_id (nullable, for future login), active                                                                                                                                                      |
| `visit_types`                      | id, hospital_id, module, name, description, active (replaces "examination_types"; e.g. "OPD Consultation", "General USG", "Pregnancy/Obstetric USG", "Abdomen & Pelvis", "KUB")                                             |
| `visits`                           | id, hospital_id, patient_id, visit_type_id, doctor_id, visit_date, notes, status, fee_amount, follow_up_date, created_at, updated_at                                                                                        |
| `document_types`                   | id, hospital_id, name, description, scope (`PATIENT` \| `VISIT`), sensitive (bool), active, version, effective_from                                                                                                         |
| `visit_type_document_requirements` | id, visit_type_id, document_type_id, required                                                                                                                                                                               |
| `documents`                        | id, hospital_id, patient_id, visit_id (nullable for PATIENT-scope), document_type_id, file_name, file_type, storage_path, file_size, sha256, page_no, scan_session_id, uploaded_by, deleted_at                              |
| `visit_payments`                   | id, hospital_id, visit_id, amount, mode (`CASH` \| `UPI` \| `CARD` \| `OTHER`), received_by, received_at, note                                                                                                              |
| `audit_logs`                       | id, hospital_id, user_id, action, target_type, target_id, metadata, created_at                                                                                                                                              |
| `subscription_payments` (Phase 8)  | id, hospital_id, amount, payment_date, payment_method, reference_number, period_start, period_end, notes                                                                                                                    |

Notes:

- `(patient_id, hospital_id)` composite foreign keys wherever a table
  references a patient, so a visit can never point at another
  centre's patient even if application code has a bug.
- Checklist requirements are copied onto each visit at creation
  (a snapshot), so later configuration changes never rewrite the
  history of past visits.

## Patient fees (manual, no payment gateway)

- `visits.fee_amount` — the fee for that visit, entered by staff
  (later: defaulted from `visit_types.default_fee`, editable with a
  note).
- `visit_payments` — one or more rows per visit: amount, mode,
  received_by, received_at, note. Status (UNPAID / PARTIAL / PAID) is
  derived from the sum of payments vs. `fee_amount`, not stored
  directly.
- Receptionists can add payments but not delete them; corrections are
  a reversal entry by an admin, audit-logged.
- A "today's collection by mode and by staff" view for the admin
  dashboard.
- No payment gateway, no UPI deep links, no card entry, no invoicing/
  GST in the MVP.

## Build phases (implement in order)

See `docs/phases/phase-N.md` for the detailed, checkable task list
and acceptance criteria for each phase below. Read only the current
phase's file.

- **Phase 0** — Product validation with a real centre (not code)
- **Phase 1a** — Project scaffold, tooling, CI
- **Phase 1b** — Auth, roles, RLS, tenant guard, audit foundation
- **Phase 1c** — Super admin provisioning, staff invites, admin MFA
- **Phase 2** — Patient records
- **Phase 3** — Visits, seeded visit types, payments
- **Phase 4** — Document upload/retrieval, ID capture, pending-documents
- **Milestone** — Working prototype, demoable to a real centre
- **Phase 5** — Phone-camera QR scanning
- **Phase 6** — Configurable visit types, document requirements, fees
- **Phase 7** — USG dashboard and workflow, PC-PNDT tracking
- **Phase 8** — Super admin dashboard, manual subscriptions
- **Phase 9** — Security hardening and pilot readiness

## Development rules for the AI coding agent

- Implement one phase at a time. Do not generate unfinished modules
  for future phases.
- After each phase: ensure the project builds and runs; report
  changed files, migration steps, environment variables, and manual
  tests performed.
- Strict TypeScript, reusable components, server-side validation,
  clear error/loading/empty states, accessible responsive UI.
- Provide `.env.example`, migrations, seed/demo data, local setup
  instructions, deployment notes.
- Dummy data only. Never insert real patient information into demo
  fixtures.
- Before claiming a feature is complete, test its happy path and the
  relevant permission/tenant-isolation failure paths.
- Start with Phase 1a only. Wait for review/approval before
  proceeding to the next phase.

## Out of scope for MVP

Pharmacy, inventory, payroll, accounting, bed management, insurance
claims, online payment gateways, full appointment system, advanced
analytics, native mobile app, mandatory AI/OCR, doctor-authored
digital reports (beyond attaching PDFs from existing report software),
digital capture of PC-PNDT form content. Consider later only after
validating the core product with a real centre.
