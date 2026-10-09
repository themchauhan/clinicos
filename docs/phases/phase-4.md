# Phase 4 — Document upload, ID capture, pending documents

## Tasks

- [ ] `document_types` table with `scope` (PATIENT/VISIT) and
      `sensitive` flag; seed at least "ID Proof" (PATIENT, sensitive)
      and "OPD Slip / Prescription" (VISIT)
- [ ] `visit_type_document_requirements` — which document types are
      required for which visit type; snapshot the checklist onto the
      visit at creation time
- [ ] Upload approved image/PDF formats from desktop to private
      Storage; storage path keyed as
      `{hospital_id}/{patient_id}/{uuid}` so storage RLS can use it
- [ ] Save document metadata in Postgres; attach to patient and
      optionally a specific visit
- [ ] Document list, preview/view, authorized download via
      short-lived signed URLs
- [ ] Validate MIME type by magic bytes (not just extension/header),
      validate size; handle upload errors and loading/empty states
- [ ] Strip EXIF/GPS metadata from uploaded photos
- [ ] Sensitive-document view logging: every view of a `sensitive`
      document writes an `audit_logs` row
- [ ] ID number, if captured as text at all, stored outside any
      generally searchable/listed column
- [ ] "Pending Documents" view: visits missing a required document

## Tests

- [ ] Happy path: authorized staff can upload and retrieve a document
- [ ] Cross-tenant: another hospital cannot access the document even
      with a guessed/leaked storage path
- [ ] Signed URLs expire and stop working after expiry
- [ ] A disallowed file type/size is rejected with a clear error
- [ ] Viewing a sensitive document produces exactly one audit log row

## Acceptance criteria

- Authorized staff can upload and retrieve a document
- Other hospitals cannot access it
- Expired access links do not remain valid
- Missing required documents are visible as "pending", not silently
  absent

## Manual test steps — later additions

- **Two-sided ID:** on a patient, choose "ID Proof", add a front and a
  back image, Upload: one document named "ID Proof (front + back)".
  Adding only one side stores "(front)" / "(back)". "Guardian / Relative
  ID Proof" is a separate slot. Scan with phone walks front, then back.
