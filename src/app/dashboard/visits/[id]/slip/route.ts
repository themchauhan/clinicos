import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { ageInYears } from "@/lib/patients/age";

/**
 * Printable OPD slip: centre header, patient name/code, date, doctor,
 * token, and blank space for the doctor to write on paper (the paper is
 * the source of truth; this only saves re-writing the header by hand).
 *
 * A plain HTML response on purpose, not a React page: PrintSlipButton
 * prints this inside a hidden iframe, and a streamed page there could be
 * captured while still showing the dashboard's loading spinner (a frozen
 * print preview). A static document is complete the moment it loads, with
 * no layout, hydration or Suspense involved.
 */

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** yyyy-mm-dd -> dd/mm/yyyy */
function indianDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

const PAGE_STYLE = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 14mm 16mm; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #18181b; }
  main { display: flex; flex-direction: column; min-height: 265mm; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; border-bottom: 2px solid #18181b; padding-bottom: 6px; }
  h1 { margin: 0; font-size: 18px; }
  .muted { color: #71717a; }
  .row { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 10px 0 0; }
  .row + .row { border-top: 1px solid #e4e4e7; padding-top: 8px; margin-top: 8px; }
  .row b { font-weight: 600; }
  .blank { display: inline-block; border-bottom: 1px solid #a1a1aa; width: 80px; }
  .blank.wide { width: 96px; }
  .writing { flex: 1; margin-top: 16px; border: 1px dashed #d4d4d8; }
  button { margin-top: 24px; padding: 8px 16px; border: 0; border-radius: 6px; background: #0d9488; color: #fff; font-size: 14px; cursor: pointer; }
  @media print { button { display: none; } }
`;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await getSessionProfile();

  const { data: visit } = await supabase
    .from("visits")
    .select(
      "visit_date, token_number, patients(name, patient_code, dob, approximate_age_years), visit_types(name), doctors(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!visit || !visit.patients) {
    return new Response("Not found", { status: 404 });
  }

  const patient = visit.patients;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Slip</title><style>${PAGE_STYLE}</style></head>
<body><main>
<header><h1>${escapeHtml(profile?.hospital?.name ?? "Centre")}</h1><span class="muted">${escapeHtml(indianDate(visit.visit_date))}</span></header>
<p class="row">
  <span><span class="muted">Patient: </span><b>${escapeHtml(patient.name)} (${escapeHtml(patient.patient_code)})</b></span>
  <span><span class="muted">Token #: </span><b>${escapeHtml(String(visit.token_number))}</b></span>
  <span><span class="muted">Type: </span><b>${escapeHtml(visit.visit_types?.name ?? "—")}</b></span>
  <span><span class="muted">Doctor: </span><b>${escapeHtml(visit.doctors?.name ?? "—")}</b></span>
</p>
<p class="row">
  <span><span class="muted">Age: </span><b>${escapeHtml(ageInYears(patient.dob, patient.approximate_age_years))}</b></span>
  <span><span class="muted">Temp: </span><span class="blank">&nbsp;</span></span>
  <span><span class="muted">BP: </span><span class="blank wide">&nbsp;</span></span>
</p>
<div class="writing"></div>
<button type="button" onclick="window.print()">Print</button>
</main></body></html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
