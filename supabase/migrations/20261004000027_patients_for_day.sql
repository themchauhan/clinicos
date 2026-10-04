-- Patients registered on, or with a visit on, a given day -- the
-- "Today" tab of the Patients list. SECURITY INVOKER (the default), so
-- the patients/visits RLS policies still scope it to the caller's own
-- hospital; this only encapsulates the OR across two tables that a
-- plain PostgREST filter can't express without a huge id list.
create or replace function public.patients_for_day(p_date date, p_day_start timestamptz)
returns setof public.patients
language sql
stable
as $$
  select p.*
  from public.patients p
  where p.deleted_at is null
    and (
      p.created_at >= p_day_start
      or exists (
        select 1 from public.visits v
        where v.patient_id = p.id and v.visit_date = p_date
      )
    )
$$;

revoke all on function public.patients_for_day(date, timestamptz) from public;
grant execute on function public.patients_for_day(date, timestamptz) to authenticated;
