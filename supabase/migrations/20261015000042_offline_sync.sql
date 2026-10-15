-- Offline sync, server side.
--
-- A tamper-evident ledger of every offline operation, plus ONE atomic function
-- that applies an operation. Design goals, in order: never lose a record,
-- never create one twice, never change one that exists, never accept a record
-- that was altered in transit or on the device, and keep proof of everything.
--
--  * Exactly-once effect. An operation is identified by a client-generated
--    op_id. Replaying it any number of times -- one after another, at the same
--    time, or after a lost reply -- returns the first outcome and creates
--    nothing. Replaying the same op_id with DIFFERENT content is refused.
--  * Create-only. The function only INSERTs new patients/visits. It contains no
--    UPDATE or DELETE of patient data, so it cannot overwrite or erase it.
--  * Possible same-person matches are HELD (needs_review), never merged, and a
--    hold can be settled exactly once.
--  * Atomic. Patient, visit, ledger, hash chain and audit rows commit together
--    or not at all.
--  * End-to-end integrity. The device hashes each operation (SHA-256 over its
--    canonical JSON); the app server re-checks the hash before calling this
--    function; the hash is stored and echoed back so the device can confirm the
--    server saw exactly what it sent.
--  * Tamper-evident. Every ledger row is chained to the previous one by hash
--    (per centre, gapless sequence). verify_offline_ledger() recomputes the
--    chain, so a changed, removed or inserted row is detectable.
--  * Least privilege. App roles cannot write the ledger at all: only this
--    function (SECURITY DEFINER, owned by the migration role) can. Because it
--    bypasses RLS, it derives the centre from the session itself and filters
--    every read and write by it explicitly.

-- Per-centre switch: rollout flag AND emergency kill switch. Off by default.
alter table public.hospitals
  add column offline_sync_enabled boolean not null default false;

create table public.offline_operations (
  hospital_id uuid not null references public.hospitals (id) on delete restrict,
  op_id uuid not null,
  -- Gapless per-centre sequence; with prev_hash/row_hash forms the chain.
  seq bigint not null check (seq > 0),
  op_type text not null
    check (op_type in ('register_patient_and_visit', 'create_visit', 'unknown')),
  device_id text check (device_id is null or length(device_id) <= 100),
  schema_version integer not null,
  client_created_at timestamptz not null,
  -- The operation exactly as received: kept forever, so every outcome can be
  -- inspected and replayed by an administrator.
  payload jsonb not null,
  -- SHA-256 hex of the operation's canonical JSON, computed on the device and
  -- verified by the app server before this function is called.
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('applied', 'needs_review', 'rejected')),
  -- A stable code (never free text, never patient data).
  error_code text,
  -- What the server assigned (real patient code, token, ...) or, for a hold,
  -- the ids of the possible matches. No patient details are copied here.
  result jsonb not null default '{}'::jsonb,
  patient_id uuid,
  visit_id uuid,
  -- A hold is settled by a NEW operation pointing back at it, so no ledger row
  -- is ever modified.
  resolves_op_id uuid,
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  primary key (hospital_id, op_id),
  unique (hospital_id, seq),
  foreign key (hospital_id, resolves_op_id)
    references public.offline_operations (hospital_id, op_id)
);

comment on table public.offline_operations is
  'Append-only, hash-chained ledger of offline operations. Written only by apply_offline_operation(); no app role has INSERT/UPDATE/DELETE.';

create index offline_operations_patient_idx on public.offline_operations (patient_id)
  where patient_id is not null;
create index offline_operations_attention_idx
  on public.offline_operations (hospital_id, created_at desc) where status <> 'applied';
create index offline_operations_resolves_idx
  on public.offline_operations (hospital_id, resolves_op_id) where resolves_op_id is not null;

-- The head of each centre's chain, locked while a row is appended so the
-- sequence stays gapless under concurrency.
create table public.offline_ledger_heads (
  hospital_id uuid primary key references public.hospitals (id) on delete restrict,
  last_seq bigint not null,
  last_hash text not null check (last_hash ~ '^[0-9a-f]{64}$')
);

alter table public.offline_operations enable row level security;
alter table public.offline_ledger_heads enable row level security;

revoke all on public.offline_operations from public, anon, authenticated;
revoke all on public.offline_ledger_heads from public, anon, authenticated;

-- A centre's administrator can read its own ledger (the "needs attention"
-- screen). Nobody can write it directly.
grant select on public.offline_operations to authenticated;
create policy "offline_operations_select_own_hospital_admin"
on public.offline_operations
for select
to authenticated
using (
  hospital_id = (select cp.hospital_id from public.current_profile() cp)
  and (select cp.role from public.current_profile() cp) = 'HOSPITAL_ADMIN'
);

-- ---------------------------------------------------------------------------

create or replace function public.apply_offline_operation(p_op jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '10s'
as $$
declare
  c_max_age_days constant integer := 14;
  c_max_payload_bytes constant integer := 65536;
  c_genesis constant text := repeat('0', 64);

  v_profile record;
  v_h uuid;
  v_status_h public.hospital_status;
  v_enabled boolean;

  v_op_id uuid;
  v_hash text;
  v_op_type text;
  v_schema integer;
  v_existing public.offline_operations%rowtype;

  v_status text;
  v_error text;
  v_result jsonb := '{}'::jsonb;

  v_patient jsonb;
  v_visit jsonb;
  v_patient_id uuid;
  v_visit_id uuid;
  v_visit_date date;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_client_created timestamptz;
  v_created_at timestamptz;
  v_resolves uuid;
  v_held public.offline_operations%rowtype;
  v_confirm boolean;
  v_dups jsonb;
  v_patient_code text;
  v_visit_number bigint;
  v_token bigint;
  v_name text;
  v_mobile text;
  v_dob date;

  v_head public.offline_ledger_heads%rowtype;
  v_seq bigint;
  v_prev text;
  v_row_hash text;

  v_state text;
  v_constraint text;
  v_msg text;
begin
  select cp.* into v_profile from public.current_profile() cp;
  if not found
     or v_profile.status <> 'ACTIVE'
     or v_profile.role not in ('HOSPITAL_ADMIN', 'RECEPTIONIST') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_h := v_profile.hospital_id;

  select h.status, h.offline_sync_enabled into v_status_h, v_enabled
  from public.hospitals h where h.id = v_h;

  -- Paused, not rejected: nothing is recorded and the operation stays queued
  -- on the device until the centre is active / sync is switched back on.
  if v_status_h in ('SUSPENDED', 'EXPIRED') then
    return jsonb_build_object('status', 'paused', 'reason', 'tenant_inactive');
  end if;
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('status', 'paused', 'reason', 'offline_sync_disabled');
  end if;

  -- Without a usable id and hash nothing can be recorded: refuse the call.
  if p_op is null or jsonb_typeof(p_op) <> 'object'
     or octet_length(p_op::text) > c_max_payload_bytes then
    raise exception 'invalid_op' using errcode = '22023';
  end if;
  v_op_id := (p_op ->> 'op_id')::uuid;
  v_hash := p_op ->> 'payload_hash';
  if v_op_id is null or v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_op' using errcode = '22023';
  end if;

  -- One operation at a time per op_id: a concurrent retry waits here, then
  -- sees the first call's committed ledger row below.
  perform pg_advisory_xact_lock(hashtextextended(v_h::text || ':op:' || v_op_id::text, 0));

  select * into v_existing
  from public.offline_operations
  where hospital_id = v_h and op_id = v_op_id;

  if found then
    if v_existing.payload <> p_op then
      -- Same id, different content: never accept, never overwrite.
      return jsonb_build_object(
        'status', 'rejected', 'op_id', v_op_id, 'payload_hash', v_hash,
        'error_code', 'op_id_reused', 'result', '{}'::jsonb, 'replayed', true
      );
    end if;
    return jsonb_build_object(
      'status', v_existing.status, 'op_id', v_op_id, 'payload_hash', v_existing.payload_hash,
      'error_code', v_existing.error_code, 'result', v_existing.result, 'replayed', true
    );
  end if;

  -- Everything that changes patient data happens in this sub-transaction: any
  -- failure rolls the whole block back, leaving no partial records.
  begin
    v_op_type := p_op ->> 'op_type';
    v_schema := (p_op ->> 'schema_version')::integer;
    if v_schema is distinct from 1 then
      raise exception 'unsupported_schema_version' using errcode = 'P0001';
    end if;
    if v_op_type is null or v_op_type not in ('register_patient_and_visit', 'create_visit') then
      raise exception 'unknown_op_type' using errcode = 'P0001';
    end if;

    v_client_created := (p_op ->> 'client_created_at')::timestamptz;
    if v_client_created is null then
      raise exception 'invalid_client_time' using errcode = 'P0001';
    end if;
    -- Keep the original time, but never in the future or absurdly old.
    v_created_at := greatest(least(v_client_created, now()), now() - interval '15 days');

    v_visit := p_op -> 'visit';
    if v_visit is null or jsonb_typeof(v_visit) <> 'object' then
      raise exception 'visit_required' using errcode = 'P0001';
    end if;
    v_visit_id := (v_visit ->> 'id')::uuid;
    v_visit_date := (v_visit ->> 'visit_date')::date;
    if v_visit_id is null or v_visit_date is null then
      raise exception 'visit_required' using errcode = 'P0001';
    end if;
    if v_visit_date > v_today or v_visit_date < v_today - c_max_age_days then
      raise exception 'visit_date_out_of_window' using errcode = 'P0001';
    end if;
    if length(coalesce(v_visit ->> 'notes', '')) > 2000
       or length(coalesce(v_visit ->> 'referred_by_name', '')) > 300
       or length(coalesce(v_visit ->> 'referred_by_hospital', '')) > 300 then
      raise exception 'field_too_long' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.visit_types
      where id = (v_visit ->> 'visit_type_id')::uuid and hospital_id = v_h and active
    ) then
      raise exception 'visit_type_inactive' using errcode = 'P0001';
    end if;
    if nullif(v_visit ->> 'doctor_id', '') is not null and not exists (
      select 1 from public.doctors
      where id = (v_visit ->> 'doctor_id')::uuid and hospital_id = v_h and active
    ) then
      raise exception 'doctor_inactive' using errcode = 'P0001';
    end if;

    -- Settling a hold: it must be a real hold of this centre, about this very
    -- visit, and a hold can be settled only once.
    v_resolves := nullif(p_op ->> 'resolves_op_id', '')::uuid;
    if v_resolves is not null then
      perform pg_advisory_xact_lock(hashtextextended(v_h::text || ':resolve:' || v_resolves::text, 0));
      select * into v_held from public.offline_operations
      where hospital_id = v_h and op_id = v_resolves and status = 'needs_review';
      if not found then
        raise exception 'unknown_resolves_op' using errcode = 'P0001';
      end if;
      if (v_held.payload -> 'visit' ->> 'id') is distinct from (v_visit ->> 'id') then
        raise exception 'resolution_mismatch' using errcode = 'P0001';
      end if;
      if exists (
        select 1 from public.offline_operations
        where hospital_id = v_h and resolves_op_id = v_resolves and status = 'applied'
      ) then
        raise exception 'already_resolved' using errcode = 'P0001';
      end if;
    end if;

    if v_op_type = 'register_patient_and_visit' then
      v_patient := p_op -> 'patient';
      if v_patient is null or jsonb_typeof(v_patient) <> 'object' then
        raise exception 'patient_required' using errcode = 'P0001';
      end if;
      v_patient_id := (v_patient ->> 'id')::uuid;
      if v_patient_id is null or (v_visit ->> 'patient_id')::uuid is distinct from v_patient_id then
        raise exception 'patient_mismatch' using errcode = 'P0001';
      end if;

      v_name := btrim(v_patient ->> 'name');
      if v_name is null or v_name = '' then
        raise exception 'name_required' using errcode = 'P0001';
      end if;
      if length(v_name) > 200
         or length(coalesce(v_patient ->> 'address', '')) > 1000
         or length(coalesce(v_patient ->> 'guardian_name', '')) > 200 then
        raise exception 'field_too_long' using errcode = 'P0001';
      end if;
      v_mobile := nullif(btrim(v_patient ->> 'mobile'), '');
      if v_mobile is not null and v_mobile !~ '^\+?[0-9]{7,15}$' then
        raise exception 'invalid_mobile' using errcode = 'P0001';
      end if;
      v_dob := nullif(v_patient ->> 'dob', '')::date;
      if v_dob is not null and v_dob > v_today then
        raise exception 'invalid_dob' using errcode = 'P0001';
      end if;

      v_confirm := coalesce((p_op ->> 'confirm_new')::boolean, false);
      if not v_confirm then
        -- Same matching rules as possible_duplicate_patients(), but filtered by
        -- this centre explicitly (this function bypasses RLS).
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', m.id, 'patient_code', m.patient_code, 'matched_on', m.matched_on)), '[]'::jsonb)
          into v_dups
        from (
          select p.id, p.patient_code,
                 case when v_mobile is not null and p.mobile = v_mobile then 'mobile' else 'name' end
                   as matched_on
          from public.patients p
          where p.hospital_id = v_h
            and p.deleted_at is null
            and (
              (v_mobile is not null and p.mobile = v_mobile)
              or (
                public.similarity(p.name, v_name) > 0.5
                and (v_dob is null or p.dob is null or abs(extract(year from age(p.dob, v_dob))) <= 2)
              )
            )
          limit 10
        ) m;
        if jsonb_array_length(v_dups) > 0 then
          -- Held for staff. Nothing is inserted and nothing is merged.
          v_status := 'needs_review';
          v_error := 'possible_duplicate';
          v_result := jsonb_build_object('candidates', v_dups);
        end if;
      end if;

      if v_status is null then
        insert into public.patients (
          id, hospital_id, name, mobile, dob, approximate_age_years, guardian_name,
          guardian_relation, gender, address, living_sons, living_sons_ages,
          living_daughters, living_daughters_ages, created_at
        ) values (
          v_patient_id, v_h, v_name, v_mobile, v_dob,
          nullif(v_patient ->> 'approximate_age_years', '')::smallint,
          nullif(btrim(v_patient ->> 'guardian_name'), ''),
          nullif(v_patient ->> 'guardian_relation', ''),
          nullif(v_patient ->> 'gender', '')::public.patient_gender,
          nullif(btrim(v_patient ->> 'address'), ''),
          nullif(v_patient ->> 'living_sons', '')::smallint,
          nullif(btrim(v_patient ->> 'living_sons_ages'), ''),
          nullif(v_patient ->> 'living_daughters', '')::smallint,
          nullif(btrim(v_patient ->> 'living_daughters_ages'), ''),
          v_created_at
        )
        returning patient_code into v_patient_code;
      end if;
    else
      -- create_visit: for a patient already in the cloud (the choice "use the
      -- existing patient"). The patient must belong to this centre and be live.
      v_patient_id := (v_visit ->> 'patient_id')::uuid;
      select p.patient_code into v_patient_code
      from public.patients p
      where p.id = v_patient_id and p.hospital_id = v_h and p.deleted_at is null;
      if not found then
        raise exception 'patient_not_found' using errcode = 'P0001';
      end if;
    end if;

    if v_status is null then
      insert into public.visits (
        id, hospital_id, patient_id, visit_type_id, doctor_id, visit_date, notes,
        referred_by_name, referred_by_hospital, fee_amount, follow_up_date, lmp_date,
        created_at
      ) values (
        v_visit_id, v_h, v_patient_id,
        (v_visit ->> 'visit_type_id')::uuid,
        nullif(v_visit ->> 'doctor_id', '')::uuid,
        v_visit_date,
        nullif(btrim(v_visit ->> 'notes'), ''),
        nullif(btrim(v_visit ->> 'referred_by_name'), ''),
        nullif(btrim(v_visit ->> 'referred_by_hospital'), ''),
        coalesce(nullif(v_visit ->> 'fee_amount', '')::numeric, 0),
        nullif(v_visit ->> 'follow_up_date', '')::date,
        nullif(v_visit ->> 'lmp_date', '')::date,
        v_created_at
      )
      returning visit_number, token_number into v_visit_number, v_token;

      v_status := 'applied';
      v_result := jsonb_build_object(
        'patient_id', v_patient_id,
        'patient_code', v_patient_code,
        'visit_id', v_visit_id,
        'visit_number', v_visit_number,
        'token_number', v_token,
        'visit_date', v_visit_date,
        'visit_type_id', v_visit ->> 'visit_type_id'
      );
    end if;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate,
                            v_constraint = constraint_name,
                            v_msg = message_text;
    -- Transient trouble (deadlock, timeout, lock wait, connection, resources):
    -- record no verdict; let the caller retry the very same operation.
    if v_state ~ '^(40|53|55|57|58|08)' then
      raise;
    end if;
    v_status := 'rejected';
    v_result := '{}'::jsonb;
    -- Our own codes are safe to store. For anything else keep only the SQLSTATE
    -- and constraint name: the message text can contain patient values.
    v_error := case
      when v_state = 'P0001' then v_msg
      else v_state || coalesce(':' || v_constraint, '')
    end;
  end;

  -- Append to the centre's hash chain (the head row is locked, so the sequence
  -- is gapless however many operations arrive at once).
  insert into public.offline_ledger_heads (hospital_id, last_seq, last_hash)
  values (v_h, 0, c_genesis)
  on conflict (hospital_id) do nothing;
  select * into v_head from public.offline_ledger_heads where hospital_id = v_h for update;
  v_seq := v_head.last_seq + 1;
  v_prev := v_head.last_hash;
  v_op_type := coalesce(
    case when p_op ->> 'op_type' in ('register_patient_and_visit', 'create_visit')
         then p_op ->> 'op_type' end,
    'unknown');
  v_row_hash := public.offline_row_hash(
    v_prev, v_seq, v_op_id, v_op_type, v_hash, v_status, v_error,
    case when v_status = 'applied' then v_patient_id end,
    case when v_status = 'applied' then v_visit_id end,
    auth.uid(), v_result
  );

  insert into public.offline_operations (
    hospital_id, op_id, seq, op_type, device_id, schema_version, client_created_at,
    payload, payload_hash, status, error_code, result, patient_id, visit_id,
    resolves_op_id, submitted_by, prev_hash, row_hash
  ) values (
    v_h, v_op_id, v_seq, v_op_type, left(p_op ->> 'device_id', 100), coalesce(v_schema, 0),
    coalesce(v_client_created, now()), p_op, v_hash, v_status, v_error, v_result,
    case when v_status = 'applied' then v_patient_id end,
    case when v_status = 'applied' then v_visit_id end,
    -- Recorded only when the hold was really settled by this operation.
    case when v_status = 'applied' then v_resolves end, auth.uid(), v_prev, v_row_hash
  );
  update public.offline_ledger_heads
  set last_seq = v_seq, last_hash = v_row_hash
  where hospital_id = v_h;

  -- Audit trail (no patient data in metadata).
  if v_status = 'applied' then
    if v_op_type = 'register_patient_and_visit' then
      insert into public.audit_logs (hospital_id, user_id, action, target_type, target_id, metadata)
      values (v_h, auth.uid(), 'patient.created', 'patient', v_patient_id,
              jsonb_build_object('via', 'offline_sync', 'op_id', v_op_id));
    end if;
    insert into public.audit_logs (hospital_id, user_id, action, target_type, target_id, metadata)
    values (v_h, auth.uid(), 'visit.created', 'visit', v_visit_id,
            jsonb_build_object('via', 'offline_sync', 'op_id', v_op_id));
  end if;
  insert into public.audit_logs (hospital_id, user_id, action, target_type, target_id, metadata)
  values (v_h, auth.uid(), 'offline.sync.' || v_status, 'offline_operation', v_op_id,
          jsonb_build_object('op_type', v_op_type, 'device_id', left(p_op ->> 'device_id', 100),
                             'error_code', v_error, 'seq', v_seq));

  return jsonb_build_object(
    'status', v_status, 'op_id', v_op_id, 'payload_hash', v_hash,
    'error_code', v_error, 'result', v_result, 'replayed', false
  );
end;
$$;

-- The chain's row hash, in one place so appending and verifying can never
-- disagree. IMMUTABLE and free of table access.
create or replace function public.offline_row_hash(
  p_prev text, p_seq bigint, p_op_id uuid, p_op_type text, p_payload_hash text,
  p_status text, p_error text, p_patient_id uuid, p_visit_id uuid, p_user uuid, p_result jsonb
)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(
    concat_ws('|', p_prev, p_seq::text, p_op_id::text, p_op_type, p_payload_hash, p_status,
              coalesce(p_error, ''), coalesce(p_patient_id::text, ''),
              coalesce(p_visit_id::text, ''), p_user::text, p_result::text),
    'UTF8')), 'hex')
$$;

-- Recomputes the chain for the caller's centre. By default it checks the most
-- recent `p_window` rows (each anchored to the stored hash of the row before the
-- window, and to the chain head), so the check stays fast however large the
-- ledger grows; p_window = 0 checks everything from the very first row.
-- Returns {ok, checked, first_bad_seq, window}. A changed, removed, reordered or
-- inserted row inside the checked range (or a head that does not match) makes ok
-- false.
create or replace function public.verify_offline_ledger(p_window integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_profile record;
  r public.offline_operations%rowtype;
  v_head public.offline_ledger_heads%rowtype;
  v_from bigint := 1;
  v_prev text := repeat('0', 64);
  v_expected_seq bigint;
  v_checked bigint := 0;
  v_first boolean := true;
begin
  select cp.* into v_profile from public.current_profile() cp;
  if not found or v_profile.status <> 'ACTIVE' or v_profile.role <> 'HOSPITAL_ADMIN' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_head from public.offline_ledger_heads where hospital_id = v_profile.hospital_id;
  if found and p_window > 0 then
    v_from := greatest(1, v_head.last_seq - p_window + 1);
  end if;
  v_expected_seq := v_from;

  for r in
    select * from public.offline_operations
    where hospital_id = v_profile.hospital_id and seq >= v_from
    order by seq
  loop
    v_checked := v_checked + 1;
    if v_first then
      -- Anchor: the window's first row names the hash of the row before it.
      v_prev := r.prev_hash;
      v_first := false;
    end if;
    if r.seq <> v_expected_seq
       or r.prev_hash <> v_prev
       or r.row_hash <> public.offline_row_hash(
            r.prev_hash, r.seq, r.op_id, r.op_type, r.payload_hash, r.status, r.error_code,
            r.patient_id, r.visit_id, r.submitted_by, r.result) then
      return jsonb_build_object('ok', false, 'checked', v_checked, 'first_bad_seq', r.seq, 'window', p_window);
    end if;
    v_prev := r.row_hash;
    v_expected_seq := v_expected_seq + 1;
  end loop;

  -- The head must agree with the last row seen (and with an empty ledger).
  if (found and (v_head.last_seq <> v_expected_seq - 1 or (v_checked > 0 and v_head.last_hash <> v_prev)))
     or (not found and v_checked > 0) then
    return jsonb_build_object('ok', false, 'checked', v_checked, 'first_bad_seq', v_expected_seq, 'window', p_window);
  end if;
  return jsonb_build_object('ok', true, 'checked', v_checked, 'first_bad_seq', null, 'window', p_window);
end;
$$;

-- Supabase's default privileges grant EXECUTE to anon; only signed-in staff
-- may call these (each checks the caller's role and centre itself).
revoke execute on function public.apply_offline_operation(jsonb) from public, anon;
grant execute on function public.apply_offline_operation(jsonb) to authenticated;
revoke execute on function public.verify_offline_ledger(integer) from public, anon;
grant execute on function public.verify_offline_ledger(integer) to authenticated;
revoke execute on function public.offline_row_hash(
  text, bigint, uuid, text, text, text, text, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.offline_row_hash(
  text, bigint, uuid, text, text, text, text, uuid, uuid, uuid, jsonb) to authenticated;

-- A deliberately light round trip to the database that also reports the
-- database clock, so a device can (a) tell "the app and its database are
-- really reachable" from a browser that merely thinks it is online, and
-- (b) measure how far its own clock is off.
create or replace function public.health_ping()
returns timestamptz
language sql
stable
as $$ select now() $$;

grant execute on function public.health_ping() to anon, authenticated;
