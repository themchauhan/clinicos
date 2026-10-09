-- Two-sided ID documents (Aadhaar, voter ID, driving licence...) and a
-- second ID slot for the patient's guardian / husband / relative.
--
-- document_types.two_sided: when set, capturing that type asks for the
-- FRONT and the BACK separately (either or both) and stores them as ONE
-- merged image -- one document to open instead of two, and the merged JPEG
-- is no bigger than a single photo used to be. The flag is the admin's
-- setting per document type; it never changes what an existing document is.

alter table public.document_types
  add column two_sided boolean not null default false;

-- The standard ID type is two-sided.
update public.document_types set two_sided = true where name = 'ID Proof';

-- A second, separate ID for whoever accompanies the patient (husband,
-- father, other relative) -- the person named as guardian on the patient.
-- Added only where the centre already uses an ID Proof, same attributes
-- (patient-level, sensitive: every view audit-logged), and left to the
-- Admin to make required per visit type in Settings.
insert into public.document_types
  (hospital_id, name, description, scope, sensitive, two_sided, active)
select distinct dt.hospital_id,
       'Guardian / Relative ID Proof',
       'ID of the husband, parent or other relative accompanying the patient.',
       'PATIENT'::document_scope, true, true, true
from public.document_types dt
where dt.name = 'ID Proof'
  and dt.active
  and not exists (
    select 1 from public.document_types x
    where x.hospital_id = dt.hospital_id and x.name = 'Guardian / Relative ID Proof'
  );
