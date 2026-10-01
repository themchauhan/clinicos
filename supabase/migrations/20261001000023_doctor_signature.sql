-- Extends the hospital-seal feature with the same idea scoped per
-- doctor instead of per hospital: a saved signature image, uploaded
-- once, auto-stamped next to the doctor's name/registration number on
-- every form that places it.
alter table public.doctors add column signature_storage_path text;

-- Mirrors seal_* on form_templates -- all nullable, since not every
-- form places a doctor signature and a doctor may not have uploaded
-- one yet when a template is designed.
alter table public.form_templates
  add column doctor_signature_page integer,
  add column doctor_signature_x numeric,
  add column doctor_signature_y numeric,
  add column doctor_signature_width numeric,
  add column doctor_signature_height numeric;
