export const GUARDIAN_RELATIONS = [
  { value: "S/O", label: "S/O — Son of" },
  { value: "D/O", label: "D/O — Daughter of" },
  { value: "W/O", label: "W/O — Wife of" },
  { value: "H/O", label: "H/O — Husband of" },
  { value: "C/O", label: "C/O — Care of" },
] as const;

export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number]["value"];

export function isGuardianRelation(value: string): value is GuardianRelation {
  return GUARDIAN_RELATIONS.some((r) => r.value === value);
}

/** "W/O Anand" -- or just the name when no relationship was recorded
 * (older patients), or "—" when there's no guardian at all. */
export function formatGuardian(relation: string | null, name: string | null): string {
  if (!name) return "—";
  return relation ? `${relation} ${name}` : name;
}
