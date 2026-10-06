-- Business overview for the main dashboard: one call, one round trip.
--
-- Everything the dashboard's "Business overview" shows for a date range:
-- visit totals, new vs returning patients, visits by doctor / weekday /
-- referrer, and -- for the centre's Admin only -- what was
-- collected (by payment mode, doctor and staff member) plus what is still
-- owed.
--
-- Rules worth knowing:
--  * Dates are India time (Asia/Kolkata), the same day boundary as the
--    visits queue and the daily token.
--  * "Visits" excludes cancelled ones (they're reported separately).
--  * "Collected" is money actually received in the range (cash basis):
--    reversals are stored as negative payments, so they net out.
--  * "Outstanding" is billed-minus-paid on the range's own visits.
--  * Money fields come back NULL unless the caller is a HOSPITAL_ADMIN --
--    enforced here, not just hidden in the UI, because receptionists can
--    otherwise read payments (they record them).
--  * SECURITY INVOKER: RLS scopes every table read to the caller's own
--    hospital; no hospital id is taken from anywhere but the session.
--  * p_totals_only returns just the headline totals, for the cheap
--    "previous period" comparison.

create index if not exists visit_payments_hospital_received_idx
  on public.visit_payments (hospital_id, received_at);

create or replace function public.dashboard_summary(
  p_from date,
  p_to date,
  p_totals_only boolean default false
)
returns jsonb
language plpgsql
stable
set search_path = public
-- Postgres' JIT compiler adds seconds of compile time to a query this size
-- for no gain; the data work itself is small and indexed.
set jit = off
as $$
declare
  v_is_admin boolean := coalesce((select cp.role = 'HOSPITAL_ADMIN' from public.current_profile() cp), false);
  v_from_ts timestamptz := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to_ts timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
  v_result jsonb;
begin
  with
  -- The period's (non-cancelled) visits, kept narrow. Only the few things
  -- that genuinely need one row per visit read this directly (distinct
  -- patients, referrers, dues); everything else reads the small grouped
  -- tables below, so a year of visits is scanned a couple of times rather
  -- than once per widget.
  vv as materialized (
    select id, patient_id, visit_date, doctor_id, fee_amount,
           referred_by_name, referred_by_hospital
    from public.visits
    where visit_date between p_from and p_to and status <> 'CANCELLED'
  ),
  vagg as materialized (
    select visit_date, doctor_id, count(*) as n, sum(fee_amount) as fee
    from vv
    group by 1, 2
  ),
  -- Money received in the period, grouped by what the widgets split it by.
  pay as materialized (
    select vp.mode, vi.doctor_id, vp.received_by, sum(vp.amount) as amt
    from public.visit_payments vp
    join public.visits vi on vi.id = vp.visit_id
    where v_is_admin and vp.received_at >= v_from_ts and vp.received_at < v_to_ts
    group by 1, 2, 3
  ),
  paid as materialized (
    select vp.visit_id, sum(vp.amount) as paid
    from public.visit_payments vp
    join vv on vv.id = vp.visit_id
    where v_is_admin
    group by vp.visit_id
  ),
  owed as materialized (
    select vv.id as visit_id, vv.patient_id, vv.visit_date,
           vv.fee_amount - coalesce(paid.paid, 0) as balance
    from vv
    left join paid on paid.visit_id = vv.id
    where v_is_admin
  ),
  seen as materialized (
    select count(distinct vv.patient_id) as patients_visited,
           count(distinct vv.patient_id) filter (where p.created_at < v_from_ts) as returning_patients
    from vv
    join public.patients p on p.id = vv.patient_id
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'is_admin', v_is_admin,
    'totals', jsonb_build_object(
      'visits', (select coalesce(sum(n), 0) from vagg),
      'cancelled', (select count(*) from public.visits
                    where visit_date between p_from and p_to and status = 'CANCELLED'),
      'patients_visited', (select patients_visited from seen),
      'new_patients', (select count(*) from public.patients
                       where created_at >= v_from_ts and created_at < v_to_ts and deleted_at is null),
      'returning_patients', (select returning_patients from seen),
      'billed', case when v_is_admin then (select coalesce(sum(fee), 0) from vagg) end,
      'collected', case when v_is_admin then (select coalesce(sum(amt), 0) from pay) end,
      'outstanding_count', case when v_is_admin then (select count(*) from owed where balance > 0) end,
      'outstanding_amount', case when v_is_admin then (select coalesce(sum(balance), 0) from owed where balance > 0) end
    ),
    'weekday', case when p_totals_only then null else (
      select jsonb_agg(jsonb_build_object('dow', d, 'visits', coalesce(x.n, 0)) order by d)
      from generate_series(1, 7) d
      left join (select extract(isodow from visit_date)::int as dow, sum(n) as n from vagg group by 1) x on x.dow = d
    ) end,
    'by_doctor', case when p_totals_only then null else (
      select coalesce(jsonb_agg(jsonb_build_object(
          'name', t.name, 'visits', t.visits, 'collected', t.collected
        ) order by t.visits desc, t.name), '[]'::jsonb)
      from (
        select coalesce(d.name, 'Unassigned') as name,
               coalesce(a.visits, 0) as visits,
               case when v_is_admin then coalesce(c.amt, 0) end as collected
        from (select doctor_id, sum(n) as visits from vagg group by 1) a
        full join (select doctor_id, sum(amt) as amt from pay group by 1) c
          on coalesce(a.doctor_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(c.doctor_id, '00000000-0000-0000-0000-000000000000'::uuid)
        left join public.doctors d on d.id = coalesce(a.doctor_id, c.doctor_id)
      ) t
    ) end,
    'referrers', case when p_totals_only then null else (
      select coalesce(jsonb_agg(jsonb_build_object(
          'name', r.name, 'hospital', r.hospital, 'visits', r.visits, 'billed', r.billed
        ) order by r.visits desc, r.name), '[]'::jsonb)
      from (
        select min(trim(referred_by_name)) as name, max(nullif(trim(referred_by_hospital), '')) as hospital,
               count(*) as visits,
               case when v_is_admin then sum(fee_amount) end as billed
        from vv
        where nullif(trim(referred_by_name), '') is not null
        group by lower(trim(referred_by_name))
        order by count(*) desc, lower(trim(referred_by_name))
        limit 10
      ) r
    ) end,
    'by_mode', case when p_totals_only or not v_is_admin then null else (
      select coalesce(jsonb_agg(jsonb_build_object('mode', m.mode, 'amount', m.amt) order by m.amt desc), '[]'::jsonb)
      from (select mode, sum(amt) as amt from pay group by 1) m
    ) end,
    'by_staff', case when p_totals_only or not v_is_admin then null else (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'amount', s.amt) order by s.amt desc), '[]'::jsonb)
      from (select coalesce(pr.name, '—') as name, sum(pay.amt) as amt
            from pay left join public.profiles pr on pr.id = pay.received_by group by 1) s
    ) end
  ) into v_result;

  return v_result;
end;
$$;

-- Supabase's default privileges grant EXECUTE to anon too; only signed-in
-- users have any business here (and RLS would show a signed-out caller
-- nothing anyway).
revoke execute on function public.dashboard_summary(date, date, boolean) from public, anon;
grant execute on function public.dashboard_summary(date, date, boolean) to authenticated;
