-- A checklist field can also draw a tick mark at a position per item.
--
-- Form F asks for the indications to be specified in item 10 AND ticked
-- against the list on the next page. One checklist field now does both:
-- its selected codes print in the field, and each selected code gets a tick
-- at its own {page, x, y} listed here. Only meaningful for input_type
-- 'checklist'; an empty list (the default) means "no ticks, codes only".

alter table public.form_template_fields
  add column tick_marks jsonb not null default '[]'::jsonb,
  add constraint form_template_fields_tick_marks_check check (
    jsonb_typeof(tick_marks) = 'array'
    and jsonb_array_length(tick_marks) <= 60
    and (input_type = 'checklist' or jsonb_array_length(tick_marks) = 0)
  );
