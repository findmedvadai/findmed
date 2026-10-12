// Care-option search shared by `search-doctors` (legacy HTTP contract) and the
// FindMed MCP (`search_care_options`).
//
// Why this exists (F01/F04 in docs/findmed-migration/hallazgos.md):
//  * cities were matched with `ilike %input%`, so "CDMX" never matched
//    "Ciudad de México" and the patient was told there were no doctors;
//  * an empty list was returned for very different situations (unknown city,
//    ambiguous city, unknown zone, unknown specialty, no active office, DB
//    error), so the caller couldn't tell "ask again" from "nobody available";
//  * callers had to infer none/one/many from a count.
//
// Matching is accent/case/punctuation-insensitive. City aliases are a small
// curated map; anything not covered falls back to a substring match that is
// reported as ambiguous when it hits more than one city.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Alias (normalized) -> canonical city name (normalized). Only well-known,
// unambiguous abbreviations; extend here when operations reports new ones.
const CITY_ALIASES: Record<string, string> = {
  "cdmx": "ciudad de mexico",
  "cd mx": "ciudad de mexico",
  "cd de mexico": "ciudad de mexico",
  "cd mexico": "ciudad de mexico",
  "ciudad mexico": "ciudad de mexico",
  "df": "ciudad de mexico",
  "d f": "ciudad de mexico",
  "distrito federal": "ciudad de mexico",
  "mexico df": "ciudad de mexico",
  "mexico city": "ciudad de mexico",
  "qro": "queretaro",
  "santiago de queretaro": "queretaro",
  "mty": "monterrey",
  "gdl": "guadalajara",
};

export interface Place {
  id: string;
  name: string;
}

export type PlaceMatch =
  | { kind: "match"; places: Place[] }
  | { kind: "ambiguous"; candidates: Place[] }
  | { kind: "unknown" };

/**
 * Resolves free text against a small catalog. Exact (normalized/alias) match
 * wins; otherwise substring in either direction. `multi` decides what several
 * substring hits mean: for cities they are ambiguous (ask the patient), for
 * zones they are sub-zones of the same area (e.g. "Polanco" → "Polanco I/II")
 * and all of them are used — the previous `ilike` behavior.
 */
export function resolvePlace(input: string, rows: Place[], multi: "ambiguous" | "union", aliases: Record<string, string> = {}): PlaceMatch {
  const q = normalizeText(input);
  if (!q) return { kind: "unknown" };
  const target = aliases[q] ?? q;
  const normalized = rows.map((r) => ({ row: r, n: normalizeText(r.name) }));

  const exact = normalized.filter((r) => r.n === target).map((r) => r.row);
  if (exact.length > 0) return { kind: "match", places: exact };

  const partial = normalized
    .filter((r) => r.n.includes(target) || (target.length >= 4 && target.includes(r.n)))
    .map((r) => r.row);
  if (partial.length === 0) return { kind: "unknown" };
  if (partial.length === 1 || multi === "union") return { kind: "match", places: partial };
  return { kind: "ambiguous", candidates: partial };
}

/** Specialty stem: "ginecología", "ginecólogo", "gineco" → "ginec". */
export function specialtyStem(term: string): string {
  const t = normalizeText(term);
  const stem = t.replace(/(logia|logo|loga|ista|ia|ico|ica)$/, "");
  return stem.length >= 3 ? stem : t;
}

export interface CareOption {
  doctor_id: string;
  doctor_name: string;
  doctor_phone: string | null;
  specialties: string[];
  office_id: string;
  office_name: string;
  office_address: string | null;
  city: string | null;
  zone: string | null;
}

export type CareSearchReason =
  | "unknown_city"
  | "ambiguous_city"
  | "unknown_zone"
  | "unknown_specialty"
  | "no_active_offices";

export type CareSearchResult =
  | {
    ok: true;
    result: "none" | "one" | "many";
    reason?: CareSearchReason;
    city: Place | null;
    city_candidates?: Place[];
    zones: Place[];
    matched_specialties: string[];
    options: CareOption[];
  }
  | { ok: false; error: "query_error"; message: string };

export async function searchCareOptions(
  supabase: SupabaseClient,
  input: { ciudad: string; especialidad: string; zona?: string | null },
): Promise<CareSearchResult> {
  type Found = Extract<CareSearchResult, { ok: true }>;
  const none = (reason: CareSearchReason, extra: Partial<Found> = {}): Found => ({
    ok: true,
    result: "none",
    reason,
    city: null,
    zones: [],
    matched_specialties: [],
    options: [],
    ...extra,
  });

  // 1. City (catalog is small: fetch and resolve in code).
  const { data: cityRows, error: cityErr } = await supabase.from("cities").select("id, name");
  if (cityErr) return { ok: false, error: "query_error", message: "cities" };
  const city = resolvePlace(input.ciudad, (cityRows ?? []) as Place[], "ambiguous", CITY_ALIASES);
  if (city.kind === "unknown") return none("unknown_city");
  if (city.kind === "ambiguous") return none("ambiguous_city", { city_candidates: city.candidates });
  const cityIds = city.places.map((c) => c.id);
  const cityOut = city.places[0];

  // 2. Zone (optional), only within the resolved city. No silent widening to
  // the whole city: the caller asks the patient first (R06).
  let zones: Place[] = [];
  if (input.zona && input.zona.trim()) {
    const { data: zoneRows, error: zoneErr } = await supabase
      .from("zones")
      .select("id, name")
      .in("city_id", cityIds);
    if (zoneErr) return { ok: false, error: "query_error", message: "zones" };
    const zone = resolvePlace(input.zona, (zoneRows ?? []) as Place[], "union");
    if (zone.kind !== "match") return none("unknown_zone", { city: cityOut });
    zones = zone.places;
  }

  // 3. Specialty.
  const stem = specialtyStem(input.especialidad);
  const { data: specRows, error: specErr } = await supabase
    .from("doctor_specialties")
    .select("doctor_id, specialties!inner(name)")
    .ilike("specialties.name", `%${stem}%`);
  if (specErr) return { ok: false, error: "query_error", message: "specialties" };
  const specMatches = (specRows ?? []) as unknown as { doctor_id: string; specialties: { name: string } }[];
  const matchedSpecialties = [...new Set(specMatches.map((m) => m.specialties?.name).filter(Boolean))];
  const doctorIds = [...new Set(specMatches.map((m) => m.doctor_id))];
  if (doctorIds.length === 0) return none("unknown_specialty", { city: cityOut, zones });

  // 4. Active offices of active doctors in the resolved city/zones.
  let officeQuery = supabase
    .from("doctor_offices")
    .select("id, doctor_id, name, address, city_id, zone_id, doctors!inner(id, full_name, phone, is_active, is_deleted)")
    .eq("is_active", true)
    .eq("is_deleted", false)
    .in("doctor_id", doctorIds)
    .in("city_id", cityIds)
    .eq("doctors.is_active", true)
    .eq("doctors.is_deleted", false);
  if (zones.length > 0) officeQuery = officeQuery.in("zone_id", zones.map((z) => z.id));
  const { data: officeRows, error: officeErr } = await officeQuery;
  if (officeErr) return { ok: false, error: "query_error", message: "offices" };
  const offices = (officeRows ?? []) as unknown as {
    id: string;
    doctor_id: string;
    name: string;
    address: string | null;
    city_id: string;
    zone_id: string | null;
    doctors: { id: string; full_name: string; phone: string | null };
  }[];
  if (offices.length === 0) {
    return none("no_active_offices", { city: cityOut, zones, matched_specialties: matchedSpecialties });
  }

  // 5. Names for display: zones of the matched offices and all specialties of
  // each matched doctor.
  const zoneIdsUsed = [...new Set(offices.map((o) => o.zone_id).filter((z): z is string => !!z))];
  const zoneNames: Record<string, string> = {};
  if (zoneIdsUsed.length > 0) {
    const { data: zr } = await supabase.from("zones").select("id, name").in("id", zoneIdsUsed);
    for (const z of (zr ?? []) as Place[]) zoneNames[z.id] = z.name;
  }
  const doctorIdsUsed = [...new Set(offices.map((o) => o.doctor_id))];
  const specsByDoctor: Record<string, string[]> = {};
  const { data: allSpecs } = await supabase
    .from("doctor_specialties")
    .select("doctor_id, specialties(name)")
    .in("doctor_id", doctorIdsUsed);
  for (const row of (allSpecs ?? []) as unknown as { doctor_id: string; specialties: { name: string } | null }[]) {
    if (!row.specialties?.name) continue;
    (specsByDoctor[row.doctor_id] ??= []).push(row.specialties.name);
  }
  const cityNames = Object.fromEntries(city.places.map((c) => [c.id, c.name]));

  const options: CareOption[] = offices
    .map((o) => ({
      doctor_id: o.doctors.id,
      doctor_name: o.doctors.full_name,
      doctor_phone: o.doctors.phone,
      specialties: specsByDoctor[o.doctors.id] ?? [],
      office_id: o.id,
      office_name: o.name,
      office_address: o.address,
      city: cityNames[o.city_id] ?? null,
      zone: o.zone_id ? zoneNames[o.zone_id] ?? null : null,
    }))
    .sort((a, b) => (a.zone ?? "").localeCompare(b.zone ?? "") || a.doctor_name.localeCompare(b.doctor_name));

  return {
    ok: true,
    result: options.length === 1 ? "one" : "many",
    city: cityOut,
    zones,
    matched_specialties: matchedSpecialties,
    options,
  };
}
