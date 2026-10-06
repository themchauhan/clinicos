-- Supabase grants EXECUTE on every new function to `anon` and
-- `authenticated` through default privileges, and `revoke ... from public`
-- does not touch those explicit grants. PostgREST exposes any function
-- they can execute as an RPC endpoint, so this migration closes that for
-- the functions added in the recent migrations.
--
-- The important one is refresh_pending_requirements(): SECURITY DEFINER,
-- it rebuilds pending items (for ALL centres when called with null). It is
-- only meant to be run by the maintenance triggers, so nobody -- signed in
-- or not -- should be able to call it over the API. (A definer function
-- calling another runs with its owner's rights, so the triggers are
-- unaffected.)

revoke execute on function public.refresh_pending_requirements(uuid) from public, anon, authenticated;

revoke execute on function public.pending_after_requirements_insert() from public, anon, authenticated;
revoke execute on function public.pending_after_document_change() from public, anon, authenticated;
revoke execute on function public.pending_after_visit_status() from public, anon, authenticated;
revoke execute on function public.hospitals_default_patient_prefix() from public, anon, authenticated;
revoke execute on function public.snapshot_visit_form_requirements() from public, anon, authenticated;

-- Signed-in-only helpers: no reason for a signed-out caller to reach them.
revoke execute on function public.patient_total() from public, anon;
revoke execute on function public.storage_usage_by_hospital() from public, anon;
revoke execute on function public.set_hospital_patient_prefix(uuid, text) from public, anon;
revoke execute on function public.next_patient_code() from public, anon;
revoke execute on function public.next_visit_token(date) from public, anon;
revoke execute on function public.matching_patient_ids(text) from public, anon;
revoke execute on function public.patients_for_day(date, timestamptz) from public, anon;
revoke execute on function public.search_patients(text) from public, anon;
revoke execute on function public.search_visits(text) from public, anon;
revoke execute on function public.possible_duplicate_patients(text, text, date) from public, anon;
