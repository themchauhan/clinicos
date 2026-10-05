-- Which fillable forms (form_templates) a visit type needs, e.g.
-- "General USG requires Form G". Mirrors the document-requirement pair
-- exactly: an admin-edited rule table, plus an immutable per-visit
-- snapshot taken by a trigger at visit creation, so changing the rule
-- later never rewrites the checklist of a visit already created.
--
-- A form requirement is fulfilled by a document on the SAME visit with
-- that form_template_id. Unlike a patient-level ID proof it is never
-- carried over from an earlier visit -- each procedure needs its own
-- signed declaration.

create table public.visit_type_form_requirements (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null default public.current_hospital_id()
    references public.hospitals (id) on delete restrict,
  visit_type_id uuid not null,
  form_template_id uuid not null,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (visit_type_id, form_template_id),
  foreign key (visit_type_id, hospital_id) references public.visit_types (id, hospital_id) on delete cascade,
  foreign key (form_template_id, hospital_id) references public.form_templates (id, hospital_id) on delete cascade
);

create index vtfr_hospital_id_idx on public.visit_type_form_requirements (hospital_id);

alter table public.visit_type_form_requirements enable row level security;

create policy "vtfr_select_own_hospital"
on public.visit_type_form_requirements
for select
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()));

create policy "vtfr_insert_own_hospital"
on public.visit_type_form_requirements
for insert
to authenticated
with check (
  hospital_id = (select hospital_id from public.current_profile())
  and (select role from public.current_profile()) = 'HOSPITAL_ADMIN'
);

create policy "vtfr_update_own_hospital"
on public.visit_type_form_requirements
for update
to authenticated
using (
  hospital_id = (select hospital_id from public.current_profile())
  and (select role from public.current_profile()) = 'HOSPITAL_ADMIN'
)
with check (
  hospital_id = (select hospital_id from public.current_profile())
  and (select role from public.current_profile()) = 'HOSPITAL_ADMIN'
);

create policy "vtfr_delete_own_hospital"
on public.visit_type_form_requirements
for delete
to authenticated
using (
  hospital_id = (select hospital_id from public.current_profile())
  and (select role from public.current_profile()) = 'HOSPITAL_ADMIN'
);

create table public.visit_form_requirements (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null default public.current_hospital_id()
    references public.hospitals (id) on delete restrict,
  visit_id uuid not null,
  form_template_id uuid not null,
  form_template_name text not null,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (visit_id, hospital_id) references public.visits (id, hospital_id) on delete cascade,
  foreign key (form_template_id, hospital_id) references public.form_templates (id, hospital_id) on delete restrict
);

create index vfr_hospital_id_idx on public.visit_form_requirements (hospital_id);
create index vfr_visit_id_idx on public.visit_form_requirements (visit_id);

alter table public.visit_form_requirements enable row level security;

create policy "vfr_select_own_hospital"
on public.visit_form_requirements
for select
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()));

create policy "vfr_insert_own_hospital"
on public.visit_form_requirements
for insert
to authenticated
with check (hospital_id = (select hospital_id from public.current_profile()));

-- SECURITY INVOKER, same as the document-requirement snapshot: the
-- insert still has to satisfy vfr_insert_own_hospital.
create or replace function public.snapshot_visit_form_requirements()
returns trigger
language plpgsql
as $$
begin
  insert into public.visit_form_requirements
    (hospital_id, visit_id, form_template_id, form_template_name, required)
  select vtfr.hospital_id, new.id, vtfr.form_template_id, ft.name, vtfr.required
  from public.visit_type_form_requirements vtfr
  join public.form_templates ft on ft.id = vtfr.form_template_id
  where vtfr.visit_type_id = new.visit_type_id
    and ft.active;
  return new;
end;
$$;

create trigger visits_snapshot_form_requirements
  after insert on public.visits
  for each row
  execute function public.snapshot_visit_form_requirements();
