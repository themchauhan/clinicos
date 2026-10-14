-- Indexes for queries that were fine with thousands of rows and would not
-- be with millions. Additive only (no data or policy changes).

-- scan_sessions: one row per scan, never deleted, and every QR click,
-- device poll (every few seconds) and patient purge filters it.
create index if not exists scan_sessions_pending_creator_idx
  on public.scan_sessions (created_by) where status = 'PENDING';
create index if not exists scan_sessions_device_pending_idx
  on public.scan_sessions (paired_device_id, created_at desc) where status = 'PENDING';
create index if not exists scan_sessions_patient_idx
  on public.scan_sessions (patient_id);
create index if not exists scan_sessions_visit_idx
  on public.scan_sessions (visit_id) where visit_id is not null;

-- /admin storage totals: lets count(*) and sum(file_size) per centre be an
-- index-only scan instead of reading every documents row.
create index if not exists documents_hospital_size_idx
  on public.documents (hospital_id) include (file_size);

-- The dashboard's pending count is count(distinct visit_id) per centre.
create index if not exists visit_pending_items_hospital_visit_idx
  on public.visit_pending_items (hospital_id, visit_id);

-- audit_logs is the table that grows fastest (one row per action).
create index if not exists audit_logs_hospital_created_idx
  on public.audit_logs (hospital_id, created_at desc);
drop index if exists public.audit_logs_hospital_id_idx;

-- Admin patient list (all patients of a centre, newest first, including
-- soft-deleted ones, which the partial index on live patients cannot serve).
create index if not exists patients_hospital_created_all_idx
  on public.patients (hospital_id, created_at desc);
