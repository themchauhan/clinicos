-- Lets a document type require a phone-captured signature instead of
-- a scanned photo/PDF, reusing the scan-session mechanism (Phase 5).
-- No RLS change needed -- the existing HOSPITAL_ADMIN-only
-- insert/update policies on document_types already cover every
-- column, same as pc_pndt_form before it.
alter table public.document_types add column requires_signature boolean not null default false;
