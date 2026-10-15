# Offline mode

Lets reception register a patient, start a visit and print a slip when the
internet, the hosted app or the database is unavailable, and syncs it safely
afterwards. **Create-only in version 1.** Off by default; a platform admin turns
it on per centre (Admin → centre → "Offline mode"). The same switch is the
emergency kill switch.

## How it works

1. While signed in online, the browser installs a small service worker
   (`public/sw.js`) that keeps the `/offline` screens available, saves who is
   signed in plus the visit types and doctors to IndexedDB, and syncs in the
   background.
2. Offline, a page navigation lands on `/offline`. A registration is checked with
   the **same rules as the online form** (`src/lib/patients/parse.ts`,
   `src/lib/visits/lmp.ts`), hashed, saved to the device in ONE durable
   transaction and **read back and re-hashed**. "Saved" is shown only after that;
   otherwise the user is told nothing was saved.
3. When a real health check (`/api/health`, which also reports the database
   clock) succeeds, the queue sends records to `POST /api/offline/sync`, which
   runs the database function `apply_offline_operation`
   (migration `20261015000042_offline_sync.sql`).

## Why sync cannot damage data

| Rule | Mechanism |
|---|---|
| **No duplicates** | Client-generated UUIDs for operation, patient and visit. The server records each operation in `offline_operations` keyed by `(centre, op_id)` under an advisory lock. Replays — one after another, at the same time, after a lost reply, or delivered twice — return the first result and create nothing. Retries re-send the **same bytes**. A double-tap or re-entry on the device is caught before queueing. |
| **No silent overwrites** | Sync only INSERTs; the function has no UPDATE/DELETE of patient data. Same `op_id` with different content → refused. A registration resembling an existing patient is **held** (`needs_review`), never merged; staff choose "register as new" or "use this existing patient" (the visit attaches; nothing is merged). A hold can be settled **exactly once** (a second decision, or one about a different visit, is refused). |
| **No hard deletion** | No delete operation exists. The ledger has no UPDATE/DELETE privilege for any app role. On the device, records only move between states (set aside ≠ deleted); clearing refuses while anything is unsynced. |
| **Transactional** | Patient, visit, ledger row, hash chain and audit rows commit together or not at all. A failure after the patient insert rolls the patient back too. |
| **Recoverable** | Full payload + outcome of every operation kept forever (incl. rejected); audit rows `offline.sync.*`; the device exports unsynced records to a file; the original creation time and visit date are preserved; a centre admin sees everything that needs attention (Settings → Offline). |
| **Fail safe** | Never "saved" without a verified local write; never "synced" without an acknowledgement for exactly that record; anything unclear stays queued and retries with backoff + jitter; the centre switch pauses sync without losing anything. |

### Techniques beyond the basics

- **End-to-end integrity.** Each operation carries a SHA-256 of its canonical
  JSON (`src/lib/offline/canonical.ts`). The device re-hashes before sending
  (a corrupted local copy is held, never sent); the app server re-hashes before
  calling the database (bytes altered in transit are refused and simply retried);
  the database stores the hash and **echoes it back**, and the device accepts the
  acknowledgement only if it matches — proof the server saw exactly what was sent.
- **Tamper-evident ledger.** Every ledger row is chained to the previous one
  (per centre, gapless `seq`, `prev_hash`/`row_hash`). `verify_offline_ledger()`
  recomputes the chain; a changed, removed or inserted row is detected. The admin
  page shows the result.
- **Least privilege.** App roles cannot write the ledger at all. Only the
  `SECURITY DEFINER` function can; because it bypasses RLS it derives the centre
  from the session and filters every read and write by it explicitly (covered by
  cross-tenant tests).
- **Device clock correction.** Each health check measures the difference between
  the server's clock and the device's; offline records are dated with the
  corrected time (the correction is stored for audit). The server also bounds the
  visit date (not future, ≤ 14 days back).
- **Minimal data on the device.** After acknowledgement the patient's details are
  dropped from the local copy. Possible-match candidates are never stored (only
  ids); their details are read live, through the user's own session, at review.
- **Multi-tab safety.** One sync at a time per computer (Web Lock); tabs notify
  each other (BroadcastChannel); an operation left "syncing" by a crash is
  re-queued.
- **Storage honesty.** Persistent storage is requested; low space, missing
  persistence, a 500-record cap and a "waiting over a day → save a backup file"
  nudge are surfaced.

### Access control and data-exposure review

- **Who can call the offline API** (`src/lib/offline/api-guard.ts`): a signed-in
  HOSPITAL_ADMIN / RECEPTIONIST of an active centre, after any second-factor
  challenge they enrolled in (a session that has not passed it is refused, as on
  every dashboard page); a cross-site POST is refused. Unauthenticated `/api/*`
  calls get a JSON 401, never a redirect.
- **The offline page is public but carries no data.** The records live in the
  browser's own store. So that signing out really locks them: sign-out forgets the
  saved session, and `/offline` asks the server who is signed in whenever it can —
  a definite "not signed in" (with a healthy backend) or "offline mode is off"
  clears the saved session. Offline (or with the backend down) the stored session
  is used for up to 12 hours; **physical access to an unlocked offline computer
  inside that window is the trust boundary** (hence: disk encryption, sign out
  at the end of the day).
- **Database.** New tables have RLS enabled and no app-role write grants; the two
  `SECURITY DEFINER` functions pin `search_path = public, pg_temp`, qualify every
  object they use, filter every statement by the centre derived from the session,
  and are not executable by `anon`. `health_ping` is public but returns only the
  time; `/api/health` caches its answer for two seconds so it cannot be used to
  hammer the database.
- **Integrity check cost.** `verify_offline_ledger()` checks the latest 5 000 rows
  by default (anchored to the stored hash before the window and to the chain head);
  `verify_offline_ledger(0)` verifies the whole chain.
- **No patient data in logs, URLs, localStorage or the service-worker cache**; the
  only server log line carries an operation id and an error code.

### How it was tested

- `tests/rls/offline-sync.rls.test.ts` — the database function against a real
  database: replays (3× sequential, 8× concurrent), tampered content, rollback,
  every validation code, holds and one-time settlement, tenant isolation, no
  direct ledger writes, hash chain gapless under 12 concurrent writes and
  tamper/removal detection.
- `tests/rls/offline-chaos.rls.test.ts` — the real sync engine on **two devices**
  against the real function with a hostile network (dropped requests, replies
  lost after commit, 500s, timeouts after commit, the same batch delivered twice
  at once, bytes corrupted in transit, the cloud briefly down), seeded and
  replayable (`CHAOS_SEED=n`), then invariants checked against the database
  (exactly one patient/visit per accepted operation, none for a hold, ledger and
  devices agree byte for byte, chain verifies). It found a real bug (a retry
  corrupted in transit after a committed-but-unacknowledged attempt was wrongly
  held); a deterministic regression test pins it.
- Unit tests for the queue, sync engine, canonical hashing, wire protocol, server
  batch logic and the service worker (run against a fake worker environment);
  Playwright end-to-end (`e2e/offline.spec.ts`) with the browser actually offline.

## What is NOT supported (v1)

Editing existing patients, payments, document upload/scan, cached patient
history, device-level revocation, and seeing one computer's offline records on
another before they sync. Server-rendered pages (the normal dashboard) need the
app and database; only `/offline` works without them.

**Local encryption is deliberately not implemented.** IndexedDB is not encrypted
at rest, and an app-level key stored in the same browser profile would give only
the appearance of protection; a PIN-derived key would make unsynced records
unrecoverable if the PIN is forgotten (and would block background sync). The
realistic controls are: minimise (above), keep data on the device only until
synced, scope it to the signed-in user, and **turn on disk encryption
(BitLocker / FileVault) on clinic computers**. Review privacy/health-data
obligations before real use.

## Offline authorization policy

Offline screens work for the person who last signed in online, for 12 hours after
the sign-in was last confirmed (`OFFLINE_WINDOW_MS`). After that, new records are
refused until they sign in online; saved records remain and sync then. A
disconnected computer cannot learn that someone's access was revoked; the server
re-checks every record when it syncs. Another account on the same computer has a
separate scope and never sees or sends these records. Unsynced records stay on
the computer until their owner signs in and syncs.

## Slip numbers

The real patient code, visit number and token are assigned by the database when
the record syncs. An offline slip shows a provisional number (device code +
count, e.g. `K7-3`) and says so. The real token is the next one for that day at
sync time, which can differ from the order on paper.

## Setup

1. Apply migration `20261015000042_offline_sync.sql` (`npx supabase db push`).
2. No new environment variables.
3. Platform admin: turn on "Offline mode" for a centre. Staff open the app once
   online (signed in) so the computer prepares itself.

## Rollback

Turn the centre's switch off (sync pauses, the shell is removed the next time the
computer is online; saved records are untouched). To remove the feature entirely:
`drop function public.apply_offline_operation(jsonb), public.verify_offline_ledger(),
public.offline_row_hash(text,bigint,uuid,text,text,text,text,uuid,uuid,uuid,jsonb),
public.health_ping(); drop table public.offline_operations, public.offline_ledger_heads;
alter table public.hospitals drop column offline_sync_enabled;` — only after
confirming no computer still holds unsynced records.

## Manual outage test (synthetic data only)

1. Switch offline mode on for a test centre; sign in on a test computer; wait a few
   seconds on the dashboard.
2. Disconnect the network (or stop the app). Open `/offline`: it loads.
3. Register a patient + visit; print the slip; note "not in the cloud yet".
4. Close the browser, reopen, open `/offline` → "Saved on this computer" lists it.
5. Reconnect. Within ~30 s it syncs; check the patient appears once with a real
   code/token. Press "Sync now" again: still one patient.
6. Register another person with the same mobile offline → after sync it is
   "Needs review"; try both choices.
7. Settings → Offline (as the centre admin): integrity check passes.
8. Switch the centre's offline mode off: waiting records pause, nothing is lost.

## Go-live checklist

- [ ] Automated tests green (unit, RLS, chaos, e2e) and the manual outage test
      passed on each supported browser (Chrome/Edge on Windows).
- [ ] Database backups / point-in-time recovery verified.
- [ ] Disk encryption enabled on the clinic computers; privacy/health-data review done.
- [ ] Staff told: offline records exist only on that computer until they sync, are
      invisible on other computers, and the slip number is provisional.
