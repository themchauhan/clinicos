-- Search that stays fast at scale.
--
-- Measured at 100k patients / 200k visits, the old search_patients,
-- possible_duplicate_patients (run on every "create patient") and
-- search_visits all scanned whole tables: each combined several
-- trigram-indexable tests -- and `similarity(...) > x`, which no index
-- can serve -- in ONE `or`, and the planner answers an OR like that with
-- a sequential scan. Here every condition is its own branch, so each can
-- use its own index, and the fuzzy (typo-tolerant) branch only runs when
-- exact matches are few -- which is the only time it is needed.
--
-- The fuzzy test is now pg_trgm's indexable `%` operator (default 0.3
-- cut-off; a per-function override isn't permitted for the migration
-- role), so search's fuzzy cut-off tightens slightly from 0.25 to 0.3.
-- The duplicate check keeps its exact 0.5 by re-checking similarity() on
-- the few rows the index returns.
--
-- All invoker-rights (no SECURITY DEFINER): the patients/visits RLS
-- policies still scope every branch to the caller's hospital.

create or replace function public.matching_patient_ids(p_query text)
returns setof uuid
language sql
stable
as $$
  with exact_ids as (
    select id from public.patients where deleted_at is null and name ilike '%' || p_query || '%'
    union
    select id from public.patients where deleted_at is null and mobile ilike '%' || p_query || '%'
    union
    select id from public.patients where deleted_at is null and patient_code ilike '%' || p_query || '%'
  )
  select id from exact_ids
  union
  select id from public.patients
  where deleted_at is null
    and name % p_query
    and (select count(*) from exact_ids) < 50
$$;

revoke all on function public.matching_patient_ids(text) from public;
grant execute on function public.matching_patient_ids(text) to authenticated;

create or replace function public.search_patients(p_query text)
returns setof public.patients
language sql
stable
as $$
  select p.*
  from public.patients p
  where p.id in (select public.matching_patient_ids(p_query))
  order by similarity(p.name, p_query) desc, p.name asc
  limit 50
$$;

create or replace function public.possible_duplicate_patients(p_name text, p_mobile text, p_dob date)
returns setof public.patients
language sql
stable
as $$
  select p.*
  from public.patients p
  where p.id in (
    select id from public.patients
    where deleted_at is null and p_mobile is not null and p_mobile <> '' and mobile = p_mobile
    union
    select id from public.patients
    where deleted_at is null
      and p_name is not null and p_name <> ''
      and name % p_name
      and similarity(name, p_name) > 0.5
      and (p_dob is null or dob is null or abs(extract(year from age(dob, p_dob))) <= 2)
  )
  limit 10
$$;

create or replace function public.search_visits(p_query text)
returns setof public.visits
language sql
stable
as $$
  select v.*
  from public.visits v
  where v.id in (
    select v2.id
    from public.visits v2
    where v2.patient_id in (select public.matching_patient_ids(p_query))
    union
    select vp.visit_id
    from public.visit_payments vp
    join public.visits v3 on v3.id = vp.visit_id
    join public.patients p3 on p3.id = v3.patient_id and p3.deleted_at is null
    where vp.reference_number ilike '%' || p_query || '%'
  )
  order by v.visit_date desc, v.token_number desc
  limit 50
$$;
