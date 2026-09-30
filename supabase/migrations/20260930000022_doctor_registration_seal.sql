-- Extends Phase 10's form templates: the performing doctor's own
-- details (name + PC&PNDT registration number) and a hospital's
-- physical seal/stamp, both of which some real forms (e.g. Form G)
-- require alongside the patient's signature.
alter table public.doctors add column registration_no text;

-- The seal image is a hospital-level fact, same shape as the
-- registration number/centre name already on this table -- uploaded
-- once, reused on every form that has a seal box.
alter table public.hospital_form_profile add column seal_storage_path text;

-- All nullable, unlike signature_* -- a seal placement is optional:
-- not every form needs one, and a hospital may not have uploaded a
-- seal yet when a template is designed.
alter table public.form_templates
  add column seal_page integer,
  add column seal_x numeric,
  add column seal_y numeric,
  add column seal_width numeric,
  add column seal_height numeric;
