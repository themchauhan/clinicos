-- Extends Phase 10 (fillable form templates): a small, tenant-editable
-- "fact sheet" a HOSPITAL_ADMIN fills in once, so form fields sourced
-- from it (e.g. a PC&PNDT registration number) never need retyping at
-- fill-time. Deliberately NOT columns on `hospitals` itself -- that
-- table's UPDATE policy is platform-admin-only
-- (20260922000011_super_admin.sql), used only by the separate
-- super-admin console for billing/status fields. This follows the
-- same hospital-owned-settings shape as document_types/form_templates
-- instead, just as a one-row-per-hospital singleton rather than a
-- multi-row list.
create table public.hospital_form_profile (
  hospital_id uuid primary key default public.current_hospital_id()
    references public.hospitals (id) on delete restrict,
  -- Overrides for a form's letterhead-style fields when they differ
  -- from the hospital's own registered name/address (e.g. an attached
  -- USG centre trading under its own name) -- null falls back to
  -- hospitals.name/address in application code, not here.
  centre_name text,
  centre_address text,
  registration_no text,
  updated_at timestamptz not null default now()
);

create trigger hospital_form_profile_set_updated_at
  before update on public.hospital_form_profile
  for each row
  execute function public.set_updated_at();

alter table public.hospital_form_profile enable row level security;

create policy "hospital_form_profile_select_own_hospital"
on public.hospital_form_profile
for select
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()));

create policy "hospital_form_profile_insert_own_hospital"
on public.hospital_form_profile
for insert
to authenticated
with check (hospital_id = (select hospital_id from public.current_profile()));

create policy "hospital_form_profile_update_own_hospital"
on public.hospital_form_profile
for update
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()))
with check (hospital_id = (select hospital_id from public.current_profile()));

-- No DELETE policy: it's a singleton fact sheet, cleared by updating
-- fields back to null, never removed.
