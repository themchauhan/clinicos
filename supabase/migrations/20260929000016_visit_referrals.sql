-- Free-text fields for an external referring doctor/hospital (e.g. a
-- USG patient sent in by a doctor at another clinic). Deliberately
-- plain text, not a FK to doctors -- a referring doctor is never on
-- this hospital's own staff and won't exist as a `doctors` row.
alter table public.visits
  add column referred_by_name text,
  add column referred_by_hospital text;
