// Mexican phone normalization shared between Edge Functions.
//
// Mexican mobile numbers have two equivalent E.164 representations:
//   * `+52XXXXXXXXXX`   — current canonical
//   * `+521XXXXXXXXXX`  — legacy Telcel format with the extra `1`
// Both refer to the same handset. Patients table rows from older flows may
// be in either form, and free-typing the number can produce yet more variants
// (spaces, dashes, parens). We canonicalize to `+52XXXXXXXXXX` for inserts,
// but lookups must consider both variants so we don't create duplicates.

export function normalizeMxPhone(raw: string): string {
  // Strip every non-digit character (including the leading `+`).
  const digitsOnly = raw.replace(/\D/g, "");
  let digits = digitsOnly;

  // Strip a leading `0` (some users type their number as `0XX...`).
  if (digits.startsWith("0")) digits = digits.slice(1);

  // Drop the legacy `1` between country code and number: 521XXXXXXXXXX → 52XXXXXXXXXX
  if (digits.startsWith("521") && digits.length === 13) {
    digits = "52" + digits.slice(3);
  }

  // No country code → assume Mexico.
  if (digits.length === 10) {
    digits = "52" + digits;
  }

  return `+${digits}`;
}

/**
 * Returns the set of E.164 strings to look up when checking whether a phone
 * is already on file. Always includes the canonical `+52XXXXXXXXXX` form and,
 * when applicable, the `+521XXXXXXXXXX` legacy form.
 */
export function mxPhoneLookupVariants(canonical: string): string[] {
  const digits = canonical.startsWith("+") ? canonical.slice(1) : canonical;
  const variants = new Set<string>([`+${digits}`]);

  if (digits.startsWith("52") && !digits.startsWith("521") && digits.length === 12) {
    variants.add(`+521${digits.slice(2)}`);
  } else if (digits.startsWith("521") && digits.length === 13) {
    variants.add(`+52${digits.slice(3)}`);
  }

  return [...variants];
}
