-- Pending requirements, computed in the database.
--
-- The dashboard, USG board and "Pending documents" page used to pull
-- every requirement and every document of the hospital into the app and
-- diff them there. PostgREST caps a response at 1000 rows, so past that
-- point fulfilled documents silently went missing and visits showed as
-- pending when they weren't -- and every page load grew with the
-- hospital's whole history. This view does the diff in SQL.
--
-- security_invoker: the underlying tables' RLS applies as the caller, so
-- a hospital only ever sees its own rows (same tenant isolation as
-- querying the tables directly).
--
-- What counts as fulfilled:
--  * a document requirement is met by a document of that type on THIS
--    visit, or -- only for PATIENT-scope types such as ID Proof, which
--    are captured once and reused -- by any document of that type on the
--    patient. A VISIT-scope type (USG report, PC-PNDT declaration) from
--    an earlier visit no longer satisfies a later visit.
--  * a form requirement is met only by a signed copy on THIS visit.
-- Cancelled visits need nothing.

create view public.pending_visit_requirements
with (security_invoker = true) as
select
  'D:' || r.id::text as id,
  v.id as visit_id,
  v.patient_id,
  v.visit_date,
  v.token_number,
  p.name as patient_name,
  p.patient_code,
  r.document_type_name as missing_name,
  false as is_form
from public.visit_document_requirements r
join public.visits v on v.id = r.visit_id
join public.patients p on p.id = v.patient_id
join public.document_types dt on dt.id = r.document_type_id
where r.required
  and v.status <> 'CANCELLED'
  and not exists (
    select 1
    from public.documents d
    where d.deleted_at is null
      and d.document_type_id = r.document_type_id
      and (d.visit_id = v.id or (dt.scope = 'PATIENT' and d.patient_id = v.patient_id))
  )
union all
select
  'F:' || r.id::text,
  v.id,
  v.patient_id,
  v.visit_date,
  v.token_number,
  p.name,
  p.patient_code,
  r.form_template_name || ' (form)',
  true
from public.visit_form_requirements r
join public.visits v on v.id = r.visit_id
join public.patients p on p.id = v.patient_id
where r.required
  and v.status <> 'CANCELLED'
  and not exists (
    select 1
    from public.documents d
    where d.deleted_at is null
      and d.visit_id = v.id
      and d.form_template_id = r.form_template_id
  );

-- Just the visit ids, for the dashboard's "documents pending" count.
create view public.visits_with_pending_requirements
with (security_invoker = true) as
select distinct visit_id from public.pending_visit_requirements;

revoke all on public.pending_visit_requirements from anon, public;
revoke all on public.visits_with_pending_requirements from anon, public;
grant select on public.pending_visit_requirements to authenticated;
grant select on public.visits_with_pending_requirements to authenticated;

-- Supporting indexes: the not-exists probes above, and the patient list
-- (newest first / "registered today") which had no index on created_at.
create index documents_patient_type_idx
  on public.documents (patient_id, document_type_id) where deleted_at is null;
create index documents_visit_form_idx
  on public.documents (visit_id, form_template_id)
  where deleted_at is null and form_template_id is not null;
create index patients_hospital_created_idx
  on public.patients (hospital_id, created_at desc) where deleted_at is null;
