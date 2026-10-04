-- How the guardian relates to the patient (S/O, D/O, W/O, H/O, C/O), so
-- forms can print "W/O Anand" instead of a bare name. Nullable with no
-- backfill: existing patients keep just their guardian_name. text + check
-- rather than an enum so a value can be added later without enum surgery.
alter table public.patients
  add column guardian_relation text
    check (guardian_relation in ('S/O', 'D/O', 'W/O', 'H/O', 'C/O'));
