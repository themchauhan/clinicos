-- patient_total() now returns the real number of patients.
--
-- It used to read the per-hospital code counter (next_number - 1), which
-- only ever goes up: it also counts patients that were later removed
-- (e.g. test patients purged from a live deployment), so the dashboard
-- total drifted above the true figure. An exact count is cheap -- it is
-- answered from the (hospital_id, created_at) index for non-deleted
-- patients -- and "how many patients do we have" must be right.
--
-- SECURITY INVOKER (the default): the patients RLS policy scopes the count
-- to the caller's own hospital, so no hospital id is taken from anywhere
-- but the session. (Replaces the earlier SECURITY DEFINER version; the
-- grants set by the earlier migrations are kept.)

create or replace function public.patient_total()
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*) from public.patients where deleted_at is null
$$;
