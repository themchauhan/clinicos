-- Optional reference number on a visit payment (e.g. a UPI
-- transaction ID) -- a separate column rather than reusing `note`,
-- which already means "reason" in the reversal-form context. Mirrors
-- hospital_subscription_payments.reference_number (same concept, one
-- level down: per visit payment instead of per subscription payment).
alter table public.visit_payments
  add column reference_number text;

create index visit_payments_reference_number_idx
  on public.visit_payments (reference_number);

-- Extend search_visits (see 20260929000015_search_visits.sql) to also
-- match a visit by its payments' reference numbers -- an `exists`
-- check rather than a join, so a visit with multiple matching
-- payments still only appears once.
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
      or exists (
        select 1 from public.visit_payments vp
        where vp.visit_id = v.id
          and vp.reference_number ilike '%' || p_query || '%'
      )
    )
  order by v.visit_date desc, v.visit_number desc
  limit 50
$$;

revoke all on function public.search_visits(text) from public;
grant execute on function public.search_visits(text) to authenticated;
