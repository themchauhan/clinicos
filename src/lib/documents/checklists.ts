/**
 * Built-in pick-lists for form fields of type "checklist". The form designer
 * attaches one by key; at fill time staff tick the items that apply, and the
 * selected CODES print in that field on the PDF (e.g. "ii, xvii").
 *
 * The lists are fixed in code on purpose: they come straight from statutory
 * forms and must read exactly as the form does.
 */

export interface ChecklistItem {
  code: string;
  label: string;
}

export interface Checklist {
  key: string;
  title: string;
  items: ChecklistItem[];
}

/** PC-PNDT Form F, item 10: the representative list of indications for
 * ultrasound during pregnancy (the form's own wording, i to xxiii). */
export const PCPNDT_INDICATIONS: Checklist = {
  key: "pcpndt_indications",
  title: "Indications for ultrasound during pregnancy (Form F, item 10)",
  items: [
    {
      code: "i",
      label: "To diagnose intra-uterine and/or ectopic pregnancy and confirm viability",
    },
    { code: "ii", label: "Estimation of gestational age (dating)" },
    { code: "iii", label: "Detection of number of fetuses and their chorionicity" },
    {
      code: "iv",
      label:
        "Suspected pregnancy with IUCD in-situ or suspected pregnancy following contraceptive failure/MTP failure",
    },
    { code: "v", label: "Vaginal bleeding/leaking" },
    { code: "vi", label: "Follow-up of cases of abortion" },
    { code: "vii", label: "Assessment of cervical canal and diameter of internal os" },
    { code: "viii", label: "Discrepancy between uterine size and period of amenorrhea" },
    { code: "ix", label: "Any suspected adenexal or uterine pathology/abnormality" },
    {
      code: "x",
      label:
        "Detection of chromosomal abnormalities, fetal structural defects and other abnormalities and their follow-up",
    },
    { code: "xi", label: "To evaluate fetal presentation and position" },
    { code: "xii", label: "Assessment of liquor amnii" },
    { code: "xiii", label: "Preterm labor/preterm premature rupture of membranes" },
    {
      code: "xiv",
      label:
        "Evaluation of placental position, thickness, grading and abnormalities (placenta praevia, retro placental haemorrhage, abnormal adherence etc.)",
    },
    {
      code: "xv",
      label:
        "Evaluation of umbilical cord – presentation, insertion, nuchal encirclement, number of vessels and presence of true knot",
    },
    { code: "xvi", label: "Evaluation of previous Caesarean Section scars" },
    {
      code: "xvii",
      label: "Evaluation of fetal growth parameters, fetal weight and fetal well being",
    },
    { code: "xviii", label: "Color flow mapping and duplex Doppler studies" },
    {
      code: "xix",
      label:
        "Ultrasound guided procedures such as medical termination of pregnancy, external cephalic version etc. and their follow-up",
    },
    {
      code: "xx",
      label:
        "Adjunct to diagnostic and therapeutic invasive interventions such as chorionic villus sampling (CVS), amniocenteses, fetal blood sampling, fetal skin biopsy, amnio-infusion, intrauterine infusion, placement of shunts etc.",
    },
    { code: "xxi", label: "Observation of intra-partum events" },
    { code: "xxii", label: "Medical/surgical conditions complicating pregnancy" },
    { code: "xxiii", label: "Research/scientific studies in recognized institutions" },
  ],
};

export const CHECKLISTS: Record<string, Checklist> = {
  [PCPNDT_INDICATIONS.key]: PCPNDT_INDICATIONS,
};

export function getChecklist(key: string | null | undefined): Checklist | null {
  return key ? (CHECKLISTS[key] ?? null) : null;
}

/** Selected codes from a stored value ("ii,xvii"), in the list's own order,
 * ignoring anything that isn't on the list. */
export function selectedCodes(value: string, checklist: Checklist): string[] {
  const chosen = new Set(
    value
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  );
  return checklist.items.map((i) => i.code).filter((code) => chosen.has(code));
}

/** What prints on the form: "ii, xvii". */
export function formatChecklistValue(value: string, checklist: Checklist): string {
  return selectedCodes(value, checklist).join(", ");
}
