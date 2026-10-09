/**
 * Living children, as PC-PNDT Form F (item 4) asks for them: how many sons
 * and daughters, and each one's age ("6 years", "8 months"). Optional --
 * most patients never need it -- and free text for the ages because that is
 * how the form is answered.
 */

export interface ChildrenInput {
  livingSons: number | null;
  livingSonsAges: string | null;
  livingDaughters: number | null;
  livingDaughtersAges: string | null;
}

export const MAX_CHILDREN = 30;
const MAX_AGES_LENGTH = 200;

function parseCount(raw: string, label: string): { value: number | null } | { error: string } {
  const text = raw.trim();
  if (text === "") return { value: null };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || n > MAX_CHILDREN) {
    return { error: `${label} must be a whole number from 0 to ${MAX_CHILDREN}.` };
  }
  return { value: n };
}

function parseAges(raw: string, label: string): { value: string | null } | { error: string } {
  const text = raw.trim();
  if (text.length > MAX_AGES_LENGTH) {
    return { error: `${label} is too long (at most ${MAX_AGES_LENGTH} characters).` };
  }
  return { value: text || null };
}

/** Reads the four children fields from a form via `get(name)`, checking each. */
export function parseChildren(
  get: (name: string) => string,
): { children: ChildrenInput } | { error: string } {
  const sons = parseCount(get("livingSons"), "Number of sons");
  if ("error" in sons) return sons;
  const daughters = parseCount(get("livingDaughters"), "Number of daughters");
  if ("error" in daughters) return daughters;
  const sonsAges = parseAges(get("livingSonsAges"), "The sons' ages");
  if ("error" in sonsAges) return sonsAges;
  const daughtersAges = parseAges(get("livingDaughtersAges"), "The daughters' ages");
  if ("error" in daughtersAges) return daughtersAges;
  return {
    children: {
      livingSons: sons.value,
      livingSonsAges: sonsAges.value,
      livingDaughters: daughters.value,
      livingDaughtersAges: daughtersAges.value,
    },
  };
}
