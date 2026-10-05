-- Pending requirements as a maintained table instead of a computed view.
--
-- The view from the previous migration is correct but evaluates every
-- requirement of the hospital's whole history on each read; measured at
-- 200k visits it took ~5s (the first draft never finished). The dashboard
-- count and the Pending documents list need to be index lookups, so the
-- currently-unfulfilled items live in their own small table, kept in sync
-- by triggers whenever something that could change the answer changes.
-- The rules themselves are unchanged and live in exactly one place,
-- refresh_pending_requirements(), so they can't drift apart.
--
-- Rules (same as before): a document requirement is met by a document of
-- that type on THIS visit, or -- for PATIENT-scope types such as ID Proof
-- -- by any such document on the patient; a form requirement only by a
-- signed copy on THIS visit; cancelled visits need nothing.

create table public.visit_pending_items (
  id text primary key,                       -- 'D:<req id>' or 'F:<req id>'
  hospital_id uuid not null references public.hospitals (id) on delete restrict,
  visit_id uuid not null,
  patient_id uuid not null,
  visit_date date not null,
  token_number bigint not null,
  is_form boolean not null,
  missing_name text not null,
  foreign key (visit_id, hospital_id) references public.visits (id, hospital_id) on delete cascade
);

create index visit_pending_items_listing_idx
  on public.visit_pending_items (hospital_id, visit_date desc, token_number desc);
create index visit_pending_items_visit_idx on public.visit_pending_items (visit_id);
create index visit_pending_items_patient_idx on public.visit_pending_items (patient_id);

-- Read-only for tenants. Only the SECURITY DEFINER maintenance function
-- below writes it (there are deliberately no insert/update/delete
-- policies); every row's hospital_id comes from the visit it describes,
-- never from the session or a parameter.
alter table public.visit_pending_items enable row level security;

create policy "visit_pending_items_select_own_hospital"
on public.visit_pending_items
for select
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()));

-- Recomputes the pending items for one patient's visits (or for everyone
-- when p_patient_id is null -- used once, for the backfill below).
create or replace function public.refresh_pending_requirements(p_patient_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_patient_id is not null then
    -- Serialise concurrent refreshes for the same patient.
    perform pg_advisory_xact_lock(hashtextextended(p_patient_id::text, 0));
  end if;

  delete from public.visit_pending_items pi
  where p_patient_id is null or pi.patient_id = p_patient_id;

  insert into public.visit_pending_items
    (id, hospital_id, visit_id, patient_id, visit_date, token_number, is_form, missing_name)
  select 'D:' || r.id::text, v.hospital_id, v.id, v.patient_id, v.visit_date, v.token_number,
         false, r.document_type_name
  from public.visit_document_requirements r
  join public.visits v on v.id = r.visit_id
  join public.document_types dt on dt.id = r.document_type_id
  where r.required
    and v.status <> 'CANCELLED'
    and (p_patient_id is null or v.patient_id = p_patient_id)
    and not exists (
      select 1 from public.documents d
      where d.deleted_at is null and d.visit_id = v.id and d.document_type_id = r.document_type_id
    )
    and not (
      dt.scope = 'PATIENT'
      and exists (
        select 1 from public.documents d
        where d.deleted_at is null and d.patient_id = v.patient_id
          and d.document_type_id = r.document_type_id
      )
    )
  union all
  select 'F:' || r.id::text, v.hospital_id, v.id, v.patient_id, v.visit_date, v.token_number,
         true, r.form_template_name || ' (form)'
  from public.visit_form_requirements r
  join public.visits v on v.id = r.visit_id
  where r.required
    and v.status <> 'CANCELLED'
    and (p_patient_id is null or v.patient_id = p_patient_id)
    and not exists (
      select 1 from public.documents d
      where d.deleted_at is null and d.visit_id = v.id and d.form_template_id = r.form_template_id
    )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.refresh_pending_requirements(uuid) from public;

-- Triggers: anything that can change what is pending.

-- New requirement rows (the per-visit snapshot, one statement per visit).
create or replace function public.pending_after_requirements_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid;
begin
  for v_patient in
    select distinct v.patient_id
    from new_rows n join public.visits v on v.id = n.visit_id
  loop
    perform public.refresh_pending_requirements(v_patient);
  end loop;
  return null;
end;
$$;

create trigger visit_document_requirements_pending
  after insert on public.visit_document_requirements
  referencing new table as new_rows
  for each statement execute function public.pending_after_requirements_insert();

create trigger visit_form_requirements_pending
  after insert on public.visit_form_requirements
  referencing new table as new_rows
  for each statement execute function public.pending_after_requirements_insert();

-- A document added, soft-deleted/restored, or removed.
create or replace function public.pending_after_document_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_pending_requirements(coalesce(new.patient_id, old.patient_id));
  return null;
end;
$$;

create trigger documents_pending_insert
  after insert on public.documents
  for each row execute function public.pending_after_document_change();
create trigger documents_pending_update
  after update of deleted_at on public.documents
  for each row when (old.deleted_at is distinct from new.deleted_at)
  execute function public.pending_after_document_change();
create trigger documents_pending_delete
  after delete on public.documents
  for each row execute function public.pending_after_document_change();

-- A visit cancelled or reinstated.
create or replace function public.pending_after_visit_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_pending_requirements(new.patient_id);
  return null;
end;
$$;

create trigger visits_pending_status
  after update of status on public.visits
  for each row when ((old.status = 'CANCELLED') is distinct from (new.status = 'CANCELLED'))
  execute function public.pending_after_visit_status();

-- Backfill from existing data (one time).
select public.refresh_pending_requirements(null);

-- The API the app already uses, now reading the table. Same columns.
create or replace view public.pending_visit_requirements
with (security_invoker = true) as
select
  pi.id,
  pi.visit_id,
  pi.patient_id,
  pi.visit_date,
  pi.token_number,
  p.name as patient_name,
  p.patient_code,
  pi.missing_name,
  pi.is_form
from public.visit_pending_items pi
join public.patients p on p.id = pi.patient_id;

create or replace view public.visits_with_pending_requirements
with (security_invoker = true) as
select distinct visit_id from public.visit_pending_items;
