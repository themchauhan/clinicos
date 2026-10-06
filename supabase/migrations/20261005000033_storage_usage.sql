-- Per-centre file storage used, for the platform admin console.
--
-- File storage is what a small deployment runs out of first, and
-- nothing reported it. documents.file_size is already recorded for every
-- stored file, so this is a cheap aggregate -- but documents are RLS-
-- scoped to their own hospital, so a platform admin can't sum across
-- centres directly. SECURITY DEFINER with an explicit platform-admin
-- gate (no rows for anyone else); no hospital id is taken from the
-- caller. Soft-deleted documents are counted: they still occupy storage.
-- (Form templates, seals and doctor signatures live in the same bucket
-- but are not tracked per file, so they are not included.)

create or replace function public.storage_usage_by_hospital()
returns table (hospital_id uuid, files bigint, bytes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select d.hospital_id, count(*)::bigint, coalesce(sum(d.file_size), 0)::bigint
  from public.documents d
  where public.is_platform_admin()
  group by d.hospital_id
$$;

revoke all on function public.storage_usage_by_hospital() from public;
grant execute on function public.storage_usage_by_hospital() to authenticated;
