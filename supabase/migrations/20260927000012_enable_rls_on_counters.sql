-- Supabase's security advisor flags patient_code_counters and
-- visit_counters as "RLS Disabled in Public" (critical). Both tables
-- were already locked down via grants alone (see their own creation
-- comments in 20260922000005_patients.sql / 20260922000006_visits.sql
-- -- "no grants to `authenticated` at all", mutated only through the
-- next_patient_code()/next_visit_number() SECURITY DEFINER
-- functions), but per CLAUDE.md hard rule #3 every tenant-owned table
-- needs RLS enabled regardless of what today's grants happen to be --
-- a future migration that grants broader table access shouldn't
-- silently reopen these. No policies are added: the intended access
-- path is exclusively the two SECURITY DEFINER functions, whose owner
-- role bypasses RLS as the table owner, so this only closes off any
-- other path.
alter table public.patient_code_counters enable row level security;
alter table public.visit_counters enable row level security;
