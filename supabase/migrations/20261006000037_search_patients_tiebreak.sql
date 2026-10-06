-- Patient search: among equally good matches, show the newest first.
--
-- search_patients returns the best 50 matches. Many people share a name
-- (Ramesh Kumar, Priya Sharma...) and equally good matches used to be
-- ordered arbitrarily, so with more than 50 of them the patient just
-- registered could fall outside the results. Ties now break by newest
-- registration, then patient code, so the order is stable and the person
-- staff just added is always near the top.
--
-- Same body as before otherwise (invoker rights: RLS still scopes it to
-- the caller's own hospital). Existing grants are kept by CREATE OR REPLACE.

create or replace function public.search_patients(p_query text)
returns setof public.patients
language sql
stable
as $$
  select p.*
  from public.patients p
  where p.id in (select public.matching_patient_ids(p_query))
  order by similarity(p.name, p_query) desc, p.name asc, p.created_at desc, p.patient_code desc
  limit 50
$$;
