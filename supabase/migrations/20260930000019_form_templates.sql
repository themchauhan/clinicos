-- Phase 10: fillable, signable form templates (e.g. PC-PNDT Form F and
-- other consent/registration forms a centre already uses on paper).
-- An admin uploads the real blank PDF once and marks where each field
-- + the signature go; at visit time staff fill the fields and hand
-- the device to the patient to sign, producing a flattened PDF that
-- looks like a genuinely filled copy of the real form -- not a
-- generated summary sheet, and not a separate structured-data record
-- kept apart from it (same "the image is the source of truth"
-- principle already used for `documents` generally).

create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null default public.current_hospital_id()
    references public.hospitals (id) on delete restrict,
  name text not null,
  description text,
  -- The blank PDF, stored in the existing "documents" bucket under a
  -- form-templates/ prefix -- not patient data, but kept in the same
  -- private bucket for one consistent storage/RLS story.
  storage_path text not null,
  -- PDF points (1/72 inch), read from the uploaded file itself at
  -- upload time -- lets the designer and the flattening step agree on
  -- one coordinate space without re-deriving it from the file twice.
  page_width numeric not null,
  page_height numeric not null,
  sensitive boolean not null default true,
  active boolean not null default true,
  version integer not null default 1,
  effective_from date not null default current_date,
  -- The signature box is a fixed special case (exactly one per
  -- template), not modeled as "just another field".
  signature_page integer not null default 1,
  signature_x numeric not null,
  signature_y numeric not null,
  signature_width numeric not null,
  signature_height numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, hospital_id)
);

create index form_templates_hospital_id_idx on public.form_templates (hospital_id);

create trigger form_templates_set_updated_at
  before update on public.form_templates
  for each row
  execute function public.set_updated_at();

alter table public.form_templates enable row level security;

create policy "form_templates_select_own_hospital"
on public.form_templates
for select
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()));

create policy "form_templates_insert_own_hospital"
on public.form_templates
for insert
to authenticated
with check (hospital_id = (select hospital_id from public.current_profile()));

create policy "form_templates_update_own_hospital"
on public.form_templates
for update
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()))
with check (hospital_id = (select hospital_id from public.current_profile()));

-- No DELETE policy -- superseded by uploading a new template with the
-- same name (mirrors document_types), or marked inactive; never hard
-- deleted, since real documents may already reference it.

create table public.form_template_fields (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null default public.current_hospital_id()
    references public.hospitals (id) on delete restrict,
  form_template_id uuid not null,
  -- Known keys ("patient_name", "guardian_name", "address") pre-fill
  -- from the matching `patients` column in the fill UI; anything else
  -- is just typed fresh. Not a foreign key to any column list -- this
  -- is an app-level convention, not a schema-enforced one.
  field_key text not null,
  label text not null,
  input_type text not null default 'text' check (input_type in ('text', 'date', 'textarea')),
  page_number integer not null default 1,
  x numeric not null,
  y numeric not null,
  font_size numeric not null default 11,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (form_template_id, field_key),
  foreign key (form_template_id, hospital_id)
    references public.form_templates (id, hospital_id) on delete cascade
);

create index form_template_fields_hospital_id_idx on public.form_template_fields (hospital_id);
create index form_template_fields_form_template_id_idx on public.form_template_fields (form_template_id);

alter table public.form_template_fields enable row level security;

create policy "form_template_fields_select_own_hospital"
on public.form_template_fields
for select
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()));

create policy "form_template_fields_insert_own_hospital"
on public.form_template_fields
for insert
to authenticated
with check (hospital_id = (select hospital_id from public.current_profile()));

create policy "form_template_fields_update_own_hospital"
on public.form_template_fields
for update
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()))
with check (hospital_id = (select hospital_id from public.current_profile()));

create policy "form_template_fields_delete_own_hospital"
on public.form_template_fields
for delete
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()));

-- Fields ARE hard-deletable (unlike form_templates/document_types) --
-- they're just position metadata for editing a template's own
-- designer, not a record of anything that happened to a patient. The
-- signed PDFs produced from them are what's retained, via `documents`.

-- Reuse `documents` for the final signed artifact instead of a
-- parallel table -- it already has Storage, RLS, signed-URL viewing,
-- and sensitive-view audit logging (see getDocumentViewUrl). A
-- document now comes from exactly one of a document_type or a
-- form_template, never both, never neither.
alter table public.documents
  alter column document_type_id drop not null,
  add column form_template_id uuid,
  add constraint documents_type_xor_template
    check (
      (document_type_id is not null and form_template_id is null)
      or (document_type_id is null and form_template_id is not null)
    ),
  add foreign key (form_template_id, hospital_id)
    references public.form_templates (id, hospital_id) on delete restrict;

create index documents_form_template_id_idx on public.documents (form_template_id);
