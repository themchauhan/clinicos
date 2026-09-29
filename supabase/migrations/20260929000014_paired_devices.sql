-- Lets a hospital pair one phone/tablet once (instead of scanning a
-- fresh one-off QR for every scan/sign request) -- same "no Supabase
-- Auth session, bearer token validated in application code, all
-- reads/writes through the service-role client" pattern as
-- scan_sessions (see that migration's own comment), just with a
-- long-lived token instead of a 12-minute one. One device at a time
-- per hospital: pairing a new one replaces the old (application code
-- deletes any existing row before inserting), so no partial unique
-- index is needed here.

create table public.paired_devices (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null default public.current_hospital_id()
    references public.hospitals (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  -- Only the hash is stored; the raw token lives only in the pairing
  -- QR/link and the device's own localStorage, never in a database
  -- row or a server log -- same invariant as scan_sessions.token_hash.
  token_hash text not null unique,
  -- Set once the phone actually taps "Connect" on /device/connect --
  -- a row can exist with this still null if a pairing was started but
  -- never completed.
  confirmed_at timestamptz,
  -- Refreshed on every poll from the device; lets the desktop show
  -- "last seen" and is the only real signal that a device is still
  -- alive and polling.
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, hospital_id)
);

create index paired_devices_hospital_id_idx on public.paired_devices (hospital_id);

alter table public.paired_devices enable row level security;

create policy "paired_devices_select_own_hospital"
on public.paired_devices
for select
to authenticated
using (hospital_id = (select hospital_id from public.current_profile()));

create policy "paired_devices_insert_own_hospital"
on public.paired_devices
for insert
to authenticated
with check (
  hospital_id = (select hospital_id from public.current_profile())
  and created_by = auth.uid()
  and (select role from public.current_profile()) in ('HOSPITAL_ADMIN', 'RECEPTIONIST')
);

create policy "paired_devices_delete_own_hospital"
on public.paired_devices
for delete
to authenticated
using (
  hospital_id = (select hospital_id from public.current_profile())
  and (select role from public.current_profile()) in ('HOSPITAL_ADMIN', 'RECEPTIONIST')
);

-- No UPDATE policy: confirmed_at/last_seen_at are written by the
-- service-role client from the phone side, which never runs under an
-- authenticated session -- same reasoning as scan_sessions' own
-- phone-side writes never going through RLS.

-- Optional: a scan_sessions row can be pre-assigned to a paired device
-- instead of (or as well as) carrying a usable QR/link. Deliberately a
-- SIMPLE (not composite) FK, unlike this table's other hospital-scoped
-- columns: paired_device_id is an internal delivery detail, not part
-- of the tenant-isolation-critical column set (application code never
-- trusts it for authorization, only for "which device to notify"), and
-- ON DELETE SET NULL on a composite FK would null every column in the
-- FK -- including hospital_id, which is NOT NULL -- and fail outright
-- whenever a paired device is deleted while a session still points at
-- it. A null paired_device_id (the default, and the only value for
-- every session created via the existing QR flow) is unaffected.
alter table public.scan_sessions
  add column paired_device_id uuid
    references public.paired_devices (id) on delete set null;

create index scan_sessions_paired_device_id_idx
  on public.scan_sessions (paired_device_id) where paired_device_id is not null;
