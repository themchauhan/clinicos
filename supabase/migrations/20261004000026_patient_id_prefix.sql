-- Patient IDs carry a per-hospital prefix: "CLC001" instead of "000001".
--
-- The prefix is suggested from the hospital's name when it is created
-- (Clarity Clinics -> CLC) and may be changed by a platform admin
-- exactly once (patient_id_prefix_locked), after which it never
-- changes -- IDs get printed on paper, so they must stay stable.

alter table public.hospitals
  add column patient_id_prefix text,
  add column patient_id_prefix_locked boolean not null default false;

-- 3 words+ -> initials of the first three ("Sunrise General Hospital"
-- -> SGH); 2 words -> two letters of the first + initial of the second
-- ("Clarity Clinics" -> CLC); 1 word -> its first three letters.
-- Collisions with another hospital's prefix get a number appended.
create or replace function public.suggest_patient_prefix(p_name text, p_hospital_id uuid default null)
returns text
language plpgsql
stable
as $$
declare
  v_words text[];
  v_base text;
  v_candidate text;
  v_n int := 1;
begin
  v_words := regexp_split_to_array(
    trim(regexp_replace(upper(coalesce(p_name, '')), '[^A-Z ]', '', 'g')),
    '\s+'
  );
  if array_length(v_words, 1) >= 3 then
    v_base := substr(v_words[1], 1, 1) || substr(v_words[2], 1, 1) || substr(v_words[3], 1, 1);
  elsif array_length(v_words, 1) = 2 then
    v_base := substr(v_words[1], 1, 2) || substr(v_words[2], 1, 1);
  else
    v_base := substr(coalesce(v_words[1], ''), 1, 3);
  end if;
  if length(v_base) < 2 then
    v_base := 'PT';
  end if;

  v_candidate := v_base;
  while exists (
    select 1 from public.hospitals
    where patient_id_prefix = v_candidate
      and (p_hospital_id is null or id <> p_hospital_id)
  ) loop
    v_n := v_n + 1;
    v_candidate := substr(v_base, 1, 4) || v_n::text;
  end loop;
  return v_candidate;
end;
$$;

-- Backfill existing hospitals (oldest first so earlier ones win ties).
do $$
declare
  h record;
begin
  for h in select id, name from public.hospitals order by created_at, id loop
    update public.hospitals
      set patient_id_prefix = public.suggest_patient_prefix(h.name, h.id)
      where id = h.id;
  end loop;
end;
$$;

alter table public.hospitals
  alter column patient_id_prefix set not null,
  add constraint hospitals_patient_id_prefix_format check (patient_id_prefix ~ '^[A-Z0-9]{2,6}$');
create unique index hospitals_patient_id_prefix_key on public.hospitals (patient_id_prefix);

-- New hospitals get a suggested prefix unless one is given.
create or replace function public.hospitals_default_patient_prefix()
returns trigger
language plpgsql
as $$
begin
  if new.patient_id_prefix is null then
    new.patient_id_prefix := public.suggest_patient_prefix(new.name, new.id);
  end if;
  return new;
end;
$$;

create trigger hospitals_default_patient_prefix
  before insert on public.hospitals
  for each row execute function public.hospitals_default_patient_prefix();

-- Code = prefix + number, at least 3 digits and growing past 999
-- (lpad would truncate "1000" to "100").
create or replace function public.format_patient_code(p_prefix text, p_number bigint)
returns text
language sql
immutable
as $$
  select p_prefix || case
    when length(p_number::text) < 3 then lpad(p_number::text, 3, '0')
    else p_number::text
  end
$$;

create or replace function public.next_patient_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hospital_id uuid := public.current_hospital_id();
  v_number bigint;
  v_prefix text;
begin
  if v_hospital_id is null then
    raise exception 'next_patient_code() called with no hospital on the current session';
  end if;

  select patient_id_prefix into v_prefix from public.hospitals where id = v_hospital_id;

  -- Atomic under concurrency, as before.
  insert into public.patient_code_counters (hospital_id, next_number)
  values (v_hospital_id, 2)
  on conflict (hospital_id) do update
    set next_number = patient_code_counters.next_number + 1
  returning next_number - 1 into v_number;

  return public.format_patient_code(v_prefix, v_number);
end;
$$;

-- Existing patients: keep the number, add the prefix (000178 -> CLC178).
update public.patients p
  set patient_code = public.format_patient_code(h.patient_id_prefix, p.patient_code::bigint)
  from public.hospitals h
  where p.hospital_id = h.id
    and p.patient_code ~ '^[0-9]+$';

-- The one allowed prefix change, platform admins only. Existing
-- patients are relabelled so every ID in the hospital shares the new
-- prefix; the number part never changes. Locks afterwards.
create or replace function public.set_hospital_patient_prefix(p_hospital_id uuid, p_prefix text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_locked boolean;
  v_new text := upper(trim(p_prefix));
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can change a patient ID prefix';
  end if;
  if v_new !~ '^[A-Z0-9]{2,6}$' then
    raise exception 'prefix must be 2-6 letters or digits';
  end if;

  select patient_id_prefix, patient_id_prefix_locked into v_old, v_locked
    from public.hospitals where id = p_hospital_id for update;
  if v_old is null then
    raise exception 'hospital not found';
  end if;
  if v_locked then
    raise exception 'this hospital''s patient ID prefix has already been changed once and is locked';
  end if;
  if exists (select 1 from public.hospitals where patient_id_prefix = v_new and id <> p_hospital_id) then
    raise exception 'that prefix is already used by another centre';
  end if;

  update public.hospitals
    set patient_id_prefix = v_new, patient_id_prefix_locked = true
    where id = p_hospital_id;

  update public.patients
    set patient_code = v_new || substr(patient_code, length(v_old) + 1)
    where hospital_id = p_hospital_id
      and left(patient_code, length(v_old)) = v_old;
end;
$$;

revoke all on function public.set_hospital_patient_prefix(uuid, text) from public;
grant execute on function public.set_hospital_patient_prefix(uuid, text) to authenticated;
