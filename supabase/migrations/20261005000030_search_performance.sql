-- Supporting indexes and the O(1) patient total. (The search functions
-- themselves are in the next migration.)

-- Equality on mobile (the duplicate check's strongest signal) had no
-- btree index at all.
create index patients_hospital_mobile_idx
  on public.patients (hospital_id, mobile) where deleted_at is null;

-- Total patients registered at the caller's hospital in O(1), read from
-- the per-hospital code counter instead of count(*) over the table.
-- SECURITY DEFINER because that counter table has no grants for
-- `authenticated`; like next_patient_code() it derives the hospital from
-- the session, never from a parameter. (Counts every patient ever
-- registered, which is what the "All patients" badge means.)
create or replace function public.patient_total()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select next_number - 1 from public.patient_code_counters
     where hospital_id = public.current_hospital_id()),
    0
  )
$$;

revoke all on function public.patient_total() from public;
grant execute on function public.patient_total() to authenticated;
