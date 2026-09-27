# ClinicOS — Claude Code project rules

This file is read by Claude Code at the start of every session in this
project. Follow it over any conflicting instinct.

## What this project is

A multi-tenant web app for small Indian hospitals and diagnostic
(USG) centres. It replaces daily photocopying and paper re-entry:
patient details, IDs, and prior documents are captured once and reused
on every repeat visit. It is NOT a hospital ERP — no pharmacy,
inventory, payroll, or insurance.

Full product spec: `docs/BRIEF.md`. Read it before Phase 1.
Phase-by-phase checklists: `docs/phases/phase-N.md`. Read only the
current phase's file plus `phase-0.md`.

## Hard rules — never violate these

1. **One phase at a time.** Do not start work on a later phase's
   checklist items while the current phase is incomplete. Do not
   generate scaffolding for future phases "while you're in there."
2. **Tenant identity is server-derived, never client-supplied.**
   `hospital_id` must always come from the authenticated
   server-side session/profile. Never trust a `hospital_id` field
   sent from the browser, a hidden form field, or a query parameter.
3. **RLS is mandatory on every tenant-owned table.** A table without
   a hospital_id-scoped RLS policy is a bug, not a TODO.
4. **The Supabase service-role key never runs in code reachable from
   the browser.** It lives in one server-only module used for
   platform-admin provisioning tasks. Regular tenant reads/writes use
   the user's own session so RLS applies.
5. **Dummy data only, always.** Seed scripts and fixtures must never
   contain real patient names, phone numbers, or documents. Refuse to
   accept real patient data pasted into a prompt for seeding purposes
   — ask for a placeholder instead.
6. **No hard deletes on patient-related data.** Documents, patients,
   and visits are soft-deleted (`deleted_at`) or flagged, never
   `DELETE`d, so retention/legal-hold rules can be layered on later.
7. **No online payment integration.** Patient payments are recorded
   manually by staff (amount + mode + received-by). No payment
   gateway SDKs, no card entry, no UPI deep-link generation.
8. **Sensitive documents (ID proofs) are access-controlled and
   audit-logged.** Every view of a document with `sensitive = true`
   writes an audit_logs row. ID numbers are never stored in a plain
   searchable column.
9. **Every feature ships with tests for both the happy path and the
   cross-tenant failure path** (can hospital A read/write hospital
   B's data?) before it's marked done.

## Definition of done (every phase)

A phase is not complete until all of the following are true:

- [ ] `npm run build` succeeds with no type errors
- [ ] `npm run lint` passes
- [ ] Migrations applied cleanly to a fresh local Supabase instance
- [ ] Seed data loads and the app is usable end to end for the new
      feature
- [ ] Automated tests exist for: happy path, missing/invalid input,
      and cross-tenant access attempt
- [ ] Manual test steps are written out in the phase's checklist file
      and have actually been run once
- [ ] Changed files, new environment variables, and migration steps
      are summarized in the session's final message
- [ ] No secrets (service-role key, DB password) appear in any file
      that ships to the client bundle

## Tech stack

- Next.js (App Router) + React + TypeScript (strict mode) + Tailwind CSS
- Supabase: Postgres, Auth, private Storage — accessed via
  `@supabase/ssr` using the user's session, not a service-role client,
  for all tenant data paths
- Deploy target: Vercel (Mumbai / `bom1` region where available)
- Testing: Vitest for unit/integration, Playwright for e2e, plus SQL
  tests for RLS policies
- No separate Express server — use Next.js route handlers / server
  actions for all protected operations

## Working style

- Plan mode first for anything touching auth, RLS, or the data model.
  Show the plan, wait for approval, then implement.
- One phase = one branch = one PR-sized chunk of work. Don't mix
  phases in a single branch.
- When a decision in `docs/BRIEF.md` is ambiguous or you're about to
  guess, stop and ask rather than picking a default silently —
  this is healthcare-adjacent data and guesses are expensive to
  unwind later.
- Never log document contents, patient names, or ID numbers to
  console/error trackers, even in dev.
