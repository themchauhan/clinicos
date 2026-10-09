-- Support for PC-PNDT Form F (and any similar statutory form).
--
-- 1. Details Form F asks for that we did not store:
--    patients: living sons / daughters with their ages (item 4)
--    visits:   last menstrual period (item 8; weeks of pregnancy are worked
--              out from it, never stored)
--    Deliberately NOT stored anywhere structured: scan results, the
--    foetus's sex, MTP indications (items 14-16). PC-PNDT is sensitive
--    about exactly these; the signed PDF is the only record, typed at fill
--    time.
--
-- 2. Form engine:
--    form_template_fields.input_type gains 'tick' (a check mark drawn at a
--    spot) and 'checklist' (pick from a built-in list; the selected codes
--    print in the field -- Form F's 23 indications). checklist_key names
--    which built-in list.
--    form_templates.extra_stamps: further placements of the hospital seal /
--    the doctor's saved signature. Form F wants the doctor's signature and
--    seal in three places; the template had room for one of each.

alter table public.patients
  add column living_sons smallint check (living_sons is null or (living_sons >= 0 and living_sons <= 30)),
  add column living_sons_ages text check (living_sons_ages is null or length(living_sons_ages) <= 200),
  add column living_daughters smallint check (living_daughters is null or (living_daughters >= 0 and living_daughters <= 30)),
  add column living_daughters_ages text check (living_daughters_ages is null or length(living_daughters_ages) <= 200);

alter table public.visits
  add column lmp_date date,
  add constraint visits_lmp_date_plausible check (
    lmp_date is null
    or (lmp_date <= visit_date and lmp_date >= visit_date - 330)
  );

alter table public.form_template_fields
  drop constraint form_template_fields_input_type_check,
  add constraint form_template_fields_input_type_check
    check (input_type = any (array['text', 'date', 'textarea', 'tick', 'checklist'])),
  add column checklist_key text,
  add constraint form_template_fields_checklist_key_check check (
    (input_type = 'checklist') = (checklist_key is not null)
  );

alter table public.form_templates
  add column extra_stamps jsonb not null default '[]'::jsonb,
  add constraint form_templates_extra_stamps_check check (
    jsonb_typeof(extra_stamps) = 'array' and jsonb_array_length(extra_stamps) <= 12
  );
