-- Extends the phone-scan/sign machinery (see 20260922000008_scan_sessions.sql
-- and 20260929000014_paired_devices.sql) to also deliver a *filled
-- form* to a patient's phone to sign there, instead of only regular
-- document_type scans. Mirrors the same xor pattern just added to
-- `documents` for form templates.
alter table public.scan_sessions
  alter column document_type_id drop not null,
  add column form_template_id uuid,
  -- What staff already typed on the front-desk screen, carried to the
  -- phone so it can show the same "review before signing" summary --
  -- same sensitivity level as the patient name this table's phone-side
  -- reads already expose over this same token (see getScanSessionInfo).
  -- Short-lived by construction: this row expires in 12 minutes and is
  -- never read again once completed.
  add column field_values jsonb,
  add constraint scan_sessions_type_xor_template
    check (
      (document_type_id is not null and form_template_id is null and field_values is null)
      or (document_type_id is null and form_template_id is not null)
    ),
  add foreign key (form_template_id, hospital_id)
    references public.form_templates (id, hospital_id) on delete restrict;

create index scan_sessions_form_template_id_idx on public.scan_sessions (form_template_id);
