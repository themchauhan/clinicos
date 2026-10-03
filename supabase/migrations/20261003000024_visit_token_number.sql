-- Per-day token number: hospitals call out patients by a number that
-- restarts at 1 every morning. visits.visit_number stays as the stable,
-- never-reset internal id; token_number is what staff and patients see.
-- No visit is deleted or rewritten -- history stays exactly as it was.

-- "Today" is the Indian calendar day, not UTC, otherwise the token
-- sequence would restart at 05:30 IST instead of at midnight.
alter table public.visits
  alter column visit_date set default ((now() at time zone 'Asia/Kolkata')::date);

create table public.visit_token_counters (
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  token_date date not null,
  next_number bigint not null default 1,
  primary key (hospital_id, token_date)
);

-- Same as visit_counters: RLS on, no policies, no grants. Only the
-- SECURITY DEFINER function below touches it.
alter table public.visit_token_counters enable row level security;

create or replace function public.next_visit_token(p_date date)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hospital_id uuid := public.current_hospital_id();
  v_number bigint;
begin
  if v_hospital_id is null then
    raise exception 'next_visit_token() called with no hospital on the current session';
  end if;

  insert into public.visit_token_counters (hospital_id, token_date, next_number)
  values (v_hospital_id, p_date, 2)
  on conflict (hospital_id, token_date) do update
    set next_number = visit_token_counters.next_number + 1
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

revoke all on function public.next_visit_token(date) from public;
grant execute on function public.next_visit_token(date) to authenticated;

alter table public.visits add column token_number bigint;

-- Backfill: number each existing visit within its own hospital + day,
-- in the order it was created.
update public.visits v
set token_number = numbered.n
from (
  select id,
         row_number() over (partition by hospital_id, visit_date order by visit_number) as n
  from public.visits
) numbered
where numbered.id = v.id;

insert into public.visit_token_counters (hospital_id, token_date, next_number)
select hospital_id, visit_date, max(token_number) + 1
from public.visits
group by hospital_id, visit_date
on conflict (hospital_id, token_date) do update
  set next_number = excluded.next_number;

alter table public.visits alter column token_number set not null;
alter table public.visits
  add constraint visits_hospital_date_token_key unique (hospital_id, visit_date, token_number);

-- A column default can't read visit_date, so a trigger fills it in.
create or replace function public.set_visit_token_number()
returns trigger
language plpgsql
as $$
begin
  if new.token_number is null then
    new.token_number := public.next_visit_token(new.visit_date);
  end if;
  return new;
end;
$$;

create trigger visits_set_token_number
  before insert on public.visits
  for each row
  execute function public.set_visit_token_number();

-- Search results read as the day's queue: newest day first, highest
-- token first within a day.
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
  order by v.visit_date desc, v.token_number desc
  limit 50
$$;

revoke all on function public.search_visits(text) from public;
grant execute on function public.search_visits(text) to authenticated;
