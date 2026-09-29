-- The Visits list page had no search at all -- staff could only find
-- an older visit by first finding the patient, then opening their
-- profile. Mirrors search_patients exactly: SECURITY INVOKER (the
-- default), so RLS on visits/patients still scopes results to the
-- caller's own hospital with no explicit hospital_id filter needed in
-- this function body, same as search_patients relies on RLS alone.
create or replace function public.search_visits(p_query text)
returns setof public.visits
language sql
stable
as $$
  select v.*
  from public.visits v
  join public.patients p on p.id = v.patient_id
  where p.deleted_at is null
    and (
      p.name ilike '%' || p_query || '%'
      or p.mobile ilike '%' || p_query || '%'
      or p.patient_code ilike '%' || p_query || '%'
      or similarity(p.name, p_query) > 0.25
    )
  order by v.visit_date desc, v.visit_number desc
  limit 50
$$;

revoke all on function public.search_visits(text) from public;
grant execute on function public.search_visits(text) to authenticated;
