/** A bare age in years -- dob takes priority (exact), falling back to
 * the recorded approximate age, then "—" if neither is known. Shared
 * by the OPD slip's vitals row and form-template auto-fill so both
 * agree on the same number. */
export function ageInYears(dob: string | null, approximateAgeYears: number | null): string {
  if (dob) {
    const years = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return String(years);
  }
  if (approximateAgeYears !== null) {
    return `~${approximateAgeYears}`;
  }
  return "—";
}
