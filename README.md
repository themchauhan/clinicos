# ClinicOS

A multi-tenant web app for small Indian hospitals and diagnostic (USG)
centres — capture patient details and documents once, reuse them on
every repeat visit. See [`docs/BRIEF.md`](docs/BRIEF.md) for the full
product spec and [`CLAUDE.md`](CLAUDE.md) for the project's hard rules
(multi-tenancy, RLS, no hard deletes, etc.).

This repo is being built phase by phase — see
[`docs/phases/`](docs/phases). Current phase: **8 — super admin
dashboard & manual subscriptions**.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React + TypeScript
  (strict) + Tailwind CSS
- [Supabase](https://supabase.com) — Postgres, Auth, private Storage,
  accessed via `@supabase/ssr` using the signed-in user's own session
  (never a service-role client) so Row Level Security applies
- [Vitest](https://vitest.dev) for unit/integration tests (including
  RLS tests that run directly against Postgres),
  [Playwright](https://playwright.dev) for e2e tests
- Deploy target: [Vercel](https://vercel.com) (`bom1` / Mumbai region)

## Prerequisites

- [Node.js](https://nodejs.org) 22 or later (`nvm use` picks up
  `.nvmrc` if you use nvm)
- npm 10 or later
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) —
  required to run Supabase locally (`supabase start`)

The Supabase CLI is installed as a project dev dependency (`npx
supabase ...` or `npm run supabase -- ...`), so no global install is
required.

## Getting started

```bash
git clone <repo-url>
cd clinicos
npm install
cp .env.example .env.local
npx supabase start
```

`supabase start` prints local API URL and keys — copy them into
`.env.local`:

```bash
npx supabase status -o env
# API_URL          -> NEXT_PUBLIC_SUPABASE_URL
# ANON_KEY         -> NEXT_PUBLIC_SUPABASE_ANON_KEY
# SERVICE_ROLE_KEY -> SUPABASE_SERVICE_ROLE_KEY
```

Then seed dummy hospitals/staff and start the app:

```bash
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in at
`/login` with any seeded account (see `scripts/seed.ts` for the full
list — all share the password `demo-password-123!`):

| Email                      | Role                       | Centre                                   |
| -------------------------- | -------------------------- | ---------------------------------------- |
| `super@platform.test`      | SUPER_ADMIN                | — (platform admin)                       |
| `admin@sunrise.test`       | HOSPITAL_ADMIN             | Sunrise General Hospital (GENERAL_OPD)   |
| `reception@sunrise.test`   | RECEPTIONIST               | Sunrise General Hospital                 |
| `admin@clarity.test`       | HOSPITAL_ADMIN             | Clarity Diagnostics (USG)                |
| `admin@wellspring.test`    | HOSPITAL_ADMIN             | Wellspring Multispecialty (both modules) |
| `deactivated@sunrise.test` | RECEPTIONIST (deactivated) | Sunrise General Hospital                 |

SUPER_ADMIN accounts require two-factor authentication (Phase 1c) —
the first sign-in prompts MFA enrollment (scan the QR with any TOTP
authenticator app). HOSPITAL_ADMIN and RECEPTIONIST accounts don't
require it at the pilot stage, to keep onboarding simple before
there's a real client — see `src/lib/auth/mfa.ts` to re-enable it for
HOSPITAL_ADMIN once one needs it.

Never commit `.env.local` or paste real Supabase secrets into a
prompt — see `CLAUDE.md` hard rule #5 on dummy data only.

### Provisioning the first SUPER_ADMIN (outside of seeding)

There's no signup route. A platform admin is always created by an
operator running:

```bash
npm run provision:super-admin -- --email you@example.com --name "Your Name"
```

This sends a Supabase invite email (check
[http://127.0.0.1:54324](http://127.0.0.1:54324) locally) so the
operator sets their own password — the script never generates or
prints one. `scripts/seed.ts` already provisions one demo platform
admin (`super@platform.test`), so you normally only need this for a
second platform admin or against a non-local project.

## Local Supabase

```bash
npx supabase start        # boot local Postgres, Auth, Storage in Docker
npx supabase status -o env  # print local API URL and keys for .env.local
npx supabase db reset      # drop and re-apply all migrations from scratch
npx supabase stop          # stop the local stack
```

Migrations live in `supabase/migrations/`. After changing one, run
`npx supabase db reset` and `npm run db:seed` again.

## Scripts

| Command                         | Purpose                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`                   | Start the Next.js dev server                                                   |
| `npm run build`                 | Production build (also type-checks)                                            |
| `npm run start`                 | Run the production build                                                       |
| `npm run lint`                  | ESLint                                                                         |
| `npm run typecheck`             | `tsc --noEmit`                                                                 |
| `npm run format`                | Prettier, writes changes                                                       |
| `npm run format:check`          | Prettier, check only (used in CI)                                              |
| `npm test`                      | Vitest unit tests + RLS integration tests (needs `supabase start` + `db:seed`) |
| `npm run test:watch`            | Vitest in watch mode                                                           |
| `npm run e2e`                   | Playwright e2e tests (builds and boots the app first)                          |
| `npm run db:seed`               | Seed dummy hospitals/staff into the local Supabase instance                    |
| `npm run provision:super-admin` | Invite a new SUPER_ADMIN (`-- --email ... --name ...`)                         |
| `npm run check:no-secrets`      | Grep the built client bundle for a leaked service-role key                     |

Playwright browsers must be installed once per machine:

```bash
npx playwright install chromium
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR:
install → lint → typecheck → start a local Supabase instance → seed →
unit/RLS tests → build → no-secrets check, then a separate job runs
the Playwright e2e suite against a seeded local Supabase instance too.

## Project structure

```
src/app/            Next.js App Router routes, layouts, error/404 pages,
                     auth routes (login, forgot/reset password), dashboard
                     (incl. /dashboard/staff, /dashboard/patients), admin,
                     MFA setup/verify
src/components/      Shared UI components
src/lib/supabase/    Supabase clients: user-session (server.ts), browser
                     (client.ts, MFA only), the one service-role client
                     (service-role.ts), middleware helper
src/lib/auth/        getSessionProfile(), requireRole(), requireActiveTenant(),
                     getMfaStatus()
src/lib/audit/       logAudit() helper
src/types/           Hand-authored Database type (see file header re: regenerating)
docs/BRIEF.md        Full product spec
docs/phases/         Phase-by-phase task lists and acceptance criteria
supabase/            Migrations, config, email templates
scripts/seed.ts                  Dev-only dummy data seeding (service-role, via tsx)
scripts/provision-super-admin.ts Operator-run first-SUPER_ADMIN provisioning
tests/rls/           RLS integration tests, run against a real local Postgres
e2e/                 Playwright e2e tests
```

## Patients (Phase 2)

- Patient codes (`000123`) are a per-hospital sequence generated
  atomically by a `next_patient_code()` Postgres function (`INSERT ...
ON CONFLICT DO UPDATE`) — safe under concurrent registrations, see
  `supabase/migrations/20260922000005_patients.sql`.
- Search (`/dashboard/patients?q=...`) matches name (fuzzy, via
  `pg_trgm`), mobile, and patient code through a `search_patients` DB
  function; RLS still applies since it's invoker-rights, not
  `SECURITY DEFINER`.
- Creating a patient checks `possible_duplicate_patients` (mobile
  match, or similar name + non-conflicting DOB) and shows a warning —
  never a hard block — before it's saved.
- No hard deletes: `patients.deleted_at` exists but nothing sets it
  yet; there's no DELETE policy on the table at all.

## Visits & payments (Phase 3)

- `visits`/`visit_types`/`doctors` follow the same composite-FK
  pattern patients established: `(patient_id, hospital_id)`,
  `(visit_type_id, hospital_id)`, `(doctor_id, hospital_id)` all
  reference the target table's `(id, hospital_id)` pair, so a visit
  can never point at another hospital's patient/visit type/doctor even
  from a bug in application code.
- `visits.visit_number` is a per-hospital sequence (same atomic
  pattern as `patient_code`), used on the printable OPD slip
  (`/dashboard/visits/[id]/slip`, opens in a new tab, hides the nav
  via Tailwind's `print:` variant).
- Payment status (UNPAID/PARTIAL/PAID) is derived at read time from
  `sum(visit_payments.amount) vs. visits.fee_amount` — never stored.
  Corrections are a separate `is_reversal = true` row with a negative
  amount, insertable only by HOSPITAL_ADMIN (RLS-enforced); no
  UPDATE/DELETE policy exists on `visit_payments` at all.
- `dashboard/layout.tsx` threads the actual requested path through
  `x-pathname` (set in `middleware.ts`) so the MFA gate returns the
  user to the page they asked for, not always `/dashboard` — a real
  bug caught by an e2e test rather than a hand-wave.

## Documents (Phase 4)

- Two document tables mirror how the brief distinguishes a
  configurable rule from its immutable history:
  `visit_type_document_requirements` is the admin-editable rule
  ("OPD Consultation requires an ID Proof", Phase 6 UI);
  `visit_document_requirements` is a snapshot of that rule copied onto
  a specific visit **by a database trigger** at insert time, so later
  changes to the rule never rewrite the record of a past visit — and
  the snapshot happens for every insert into `visits` regardless of
  which code path creates the row, not just `createVisit()`.
- `document_types.scope` (`PATIENT` or `VISIT`) is what lets a
  document like ID Proof be captured once on a patient and
  automatically satisfy the same requirement on every visit, instead
  of being re-uploaded each time; a visit's checklist is fulfilled by
  any document of that type at either the visit or the patient level.
- Uploads are validated server-side by magic bytes
  (`src/lib/documents/file-validation.ts`), never by the
  browser-supplied extension/MIME header, and images are re-encoded
  through `sharp` to strip EXIF metadata before they ever reach
  Storage.
- The `documents` Storage bucket is fully private; every read goes
  through a signed URL (60s TTL) minted server-side by
  `getDocumentViewUrl()`, which only runs after the caller's own RLS
  already scoped the `documents` row to their hospital. Viewing a
  document flagged `sensitive` (e.g. ID Proof) writes an
  `audit_logs` row.
- `/dashboard/documents` ("Pending documents") lists every visit still
  missing a required document across the hospital — the safety net
  the brief calls for so nothing is silently lost.
- A real bug an e2e test caught: `ViewDocumentButton` opened a blank
  tab synchronously (to survive the click gesture past an `await`)
  with `window.open(..., "noopener")` and kept the returned reference
  to redirect it later — but `noopener` makes Chromium return `null`,
  so the reference-based redirect silently no-opped and the tab stayed
  on `about:blank` forever. Fixed by targeting a named window instead
  of holding a reference (`window.open("", name)` then later
  `window.open(url, name, "noopener,noreferrer")`), which needs no
  reference at all.

## Phone-camera QR scanning (Phase 5)

- The phone that scans the QR never signs in — it has no Supabase
  Auth session at all, so none of the RLS policies elsewhere in this
  schema can apply to it. Its only credential is a random 256-bit
  token (only its sha256 hash is ever stored, in `scan_sessions`);
  reads/writes made on its strength go through the service-role client
  after independently re-validating the token — see the updated doc
  comment on `src/lib/supabase/service-role.ts` and
  `src/lib/scan/resolve-session.ts`.
- The QR (and a plain-text fallback link below it, for no-camera-handy
  cases) encodes `/scan#<token>` — a URL **fragment**, never a query
  string, so the raw token is never sent in the initial page-load
  request line and never appears in a server access log.
- A session is scoped to one hospital + patient + (optional) visit +
  document type, expires after 12 minutes, and is single-use: once
  finished (`finishScanSession`) it can't be reused, matching the
  brief's "Session is invalidated immediately after use or on expiry."
  Only one live QR per staff member at a time — creating a new one
  cancels that staff member's previous still-pending session.
- Multiple pages per session are supported (reorder, delete, "add
  another page"); deleting a page during the scan is a soft delete
  (`deleted_at`), same as everywhere else — hard rule #6 doesn't carve
  out an exception for "not yet finished."
- The desktop's "Scan with phone" panel polls every ~2.5s and calls
  `router.refresh()` when new pages appear, so the already-open
  patient/visit page updates without a manual reload.
- Deliberately out of scope for this MVP (see the Phase 5 plan for the
  full reasoning): a live camera preview beyond the plain
  `<input capture="environment">`, automatic multi-page-to-PDF
  combination, cron-based cleanup of expired `scan_sessions` rows, and
  IP-based rate limiting.

## Configurable visit types & documents (Phase 6)

- `/dashboard/settings` (HOSPITAL_ADMIN only) makes what was seed-only
  data admin-editable: enabling/disabling modules (GENERAL_OPD/USG),
  visit types (with a `default_fee` that pre-fills — but never locks —
  the fee on a new visit), document types, and which document types
  are required/optional per visit type.
- This is also the first phase to give `visit_types`,
  `document_types`, and `visit_type_document_requirements` real
  INSERT/UPDATE/DELETE RLS policies; the previous phases' policies for
  these tables checked hospital match only, not role, so this phase
  tightens all of them to HOSPITAL_ADMIN specifically — RLS enforces
  that independently of the fact that no UI ever offered a
  RECEPTIONIST these actions.
- The requirements matrix (document type × visit type) is a tri-state
  toggle — none / optional / required — backed by inserting, updating,
  or deleting a single `visit_type_document_requirements` row per
  cell; it never touches the Phase 4 snapshot trigger, so editing a
  rule only ever changes the checklist for visits created afterward,
  never a visit that already snapshotted its own checklist.
- A document type's `scope` (PATIENT vs VISIT) is set once at creation
  and not editable afterward — changing it on a type already attached
  to real documents would be a data-integrity trap, not a simple field
  edit.

## USG dashboard, workflow & PC-PNDT tracking (Phase 7)

- `/dashboard/usg` (any hospital staff role, but only for hospitals
  with the USG module enabled — redirects to `/dashboard` otherwise)
  is a same-day Kanban over that hospital's USG visits: **Waiting**,
  **Documents pending**, **In progress**, **Completed**. Every visit
  lands in exactly one column, by precedence — `COMPLETED`/
  `IN_PROGRESS` status first, then whether a required document is
  still missing, else Waiting — and a "today's collection by mode and
  by staff" summary (spanning all visits, not just USG) sits below it.
- A visit's examination status (`visits.status`, gained `IN_PROGRESS`
  this phase) only ever moves forward — SCHEDULED → IN_PROGRESS →
  COMPLETED — with no back-transitions and no gate on the document
  checklist being complete first; the checklist is informational here,
  same as Pending Documents and the duplicate-patient warning
  elsewhere in this app.
- **PC-PNDT declarations reuse `document_types.version`/
  `effective_from`**, unused since the Phase 4 migration for exactly
  this purpose. Creating a document type with the same name as an
  existing one (in `/dashboard/settings`) supersedes it as a new
  version — the version number is always server-derived, never
  trusted from the client — and a document type flagged "PC-PNDT
  declaration" shows its current version/effective date on any visit
  that requires it.
- **Fetal-sex safeguard**: no field anywhere in this schema captures
  examination findings or fetal sex — documents are opaque scanned
  images/PDFs, and `visits.notes` is free text staff already control.
  That is the actual safeguard: there is nothing structured to
  disclose because nothing structured is ever captured. This is a
  deliberate, load-bearing omission, not something left for later.

## Super admin dashboard & subscriptions (Phase 8)

- `/admin` (SUPER_ADMIN only) is a real console now: centre counts by
  status, a full centre list, a **Create centre** flow (name/address/
  modules + inviting that centre's first HOSPITAL_ADMIN — the exact
  same service-role invite pattern `inviteStaff` already used, just
  cross-tenant since the acting user has no hospital of their own),
  and a per-centre page to change status/plan and record subscription
  payments.
- `hospitals`/`hospital_modules` had **zero write policies at all**
  since Phase 1b, by design — writes only ever happened via seed
  scripts/service-role. This phase adds the real path: a verified
  platform admin (`is_platform_admin()`), using their own session, no
  service-role needed except for the Admin API calls
  (`inviteUserByEmail`) that no regular session can make regardless of
  role.
- **Recording a subscription payment reactivates the centre and
  extends it** in the same action — a payment naturally un-suspends a
  centre and pushes `subscription_ends_at` to the period's end,
  rather than being two separate steps an admin has to remember to do
  in the right order.
- `requireActiveTenant()` (built in Phase 1b) already gates every
  write action in the app against a SUSPENDED/EXPIRED hospital — this
  phase's own audit confirmed every `requireRole(` call site already
  wraps it, so a suspended centre's staff can still **view** existing
  data but can't write, satisfying "data preserved, read-only" without
  any new code.
- **Known gap, deliberately deferred to Phase 9**: the check above is
  enforced at the Next.js server-action layer, not at the RLS layer —
  a `patients`/`visits`/etc. INSERT policy only checks `hospital_id`,
  never `hospitals.status`, so a valid session for a suspended
  hospital's staff could still write directly via PostgREST, bypassing
  the app entirely. Closing that fully means threading a
  hospital-active check through every tenant-owned table's write
  policies — squarely a Phase 9 (security hardening) task, not this
  one.

## Deployment notes

Not yet configured — deployment to Vercel (Mumbai/`bom1` region) lands
once more of the core document workflow exists (Phase 4+).
