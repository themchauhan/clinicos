-- The substring searches these three columns already do (`ilike '%'
-- || p_query || '%'` in search_patients/search_visits) can't use a
-- plain btree index -- a leading wildcard means Postgres has no
-- choice but to sequentially scan the whole table regardless. `name`
-- already has a GIN trigram index for exactly this reason
-- (patients_name_trgm_idx); mobile, patient_code, and reference_number
-- were missed. This is a pure performance addition -- no behavior
-- change, same query results, just found the same way faster as each
-- table grows past a trivial row count.
create index patients_mobile_trgm_idx on public.patients using gin (mobile gin_trgm_ops);
create index patients_patient_code_trgm_idx on public.patients using gin (patient_code gin_trgm_ops);
create index visit_payments_reference_number_trgm_idx
  on public.visit_payments using gin (reference_number gin_trgm_ops);

-- Both plain btrees below only ever helped an exact/prefix match,
-- which nothing here does -- each superseded by its trigram twin
-- above.
drop index if exists public.patients_mobile_idx;
drop index if exists public.visit_payments_reference_number_idx;
