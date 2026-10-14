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
import { type GeoPoint, geocodeMx, haversineKm, roundKm, toPoint } from "./geo.ts";
import { findMxPlace, normalizePlace } from "./mx-places.ts";

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
// Also used by the network search (hospitals/laboratories, network-search.ts).
export const CITY_ALIASES: Record<string, string> = {
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
  "edomex": "estado de mexico",
  "edo mex": "estado de mexico",
  "edo de mexico": "estado de mexico",
  "edo mexico": "estado de mexico",
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

/**
 * Cities where a specialty has bookable offices (active office of an active
 * doctor), with how many, most first. Used to offer alternatives instead of
 * "no hay médicos" when a search comes back empty. null = query failed.
 */
export async function citiesWithSpecialty(
  supabase: SupabaseClient,
  especialidad: string,
  excludeCityIds: string[] = [],
): Promise<{ city_id: string; city: string; options: number }[] | null> {
  const stem = specialtyStem(especialidad);
  const { data: specRows, error: specErr } = await supabase
    .from("doctor_specialties")
    .select("doctor_id, specialties!inner(name)")
    .ilike("specialties.name", `%${stem}%`);
  if (specErr) return null;
  const doctorIds = [...new Set(((specRows ?? []) as { doctor_id: string }[]).map((m) => m.doctor_id))];
  if (doctorIds.length === 0) return [];

  const { data: officeRows, error: officeErr } = await supabase
    .from("doctor_offices")
    .select("id, city_id, doctors!inner(is_active, is_deleted)")
    .eq("is_active", true)
    .eq("is_deleted", false)
    .in("doctor_id", doctorIds)
    .eq("doctors.is_active", true)
    .eq("doctors.is_deleted", false);
  if (officeErr) return null;
  const counts = new Map<string, number>();
  for (const o of (officeRows ?? []) as { city_id: string | null }[]) {
    if (!o.city_id || excludeCityIds.includes(o.city_id)) continue;
    counts.set(o.city_id, (counts.get(o.city_id) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const { data: cityRows, error: cityErr } = await supabase.from("cities").select("id, name").in("id", [...counts.keys()]);
  if (cityErr) return null;
  const names = Object.fromEntries(((cityRows ?? []) as Place[]).map((c) => [c.id, c.name]));
  return [...counts.entries()]
    .filter(([id]) => names[id])
    .map(([id, n]) => ({ city_id: id, city: names[id], options: n }))
    .sort((a, b) => b.options - a.options || a.city.localeCompare(b.city));
}

// --- Nearest options (14-oct-2026) --------------------------------------------
//
// Client complaint: "no tengo médicos en Chimalhuacán, te canalizo con alguien"
// sends the patient back to manual work. With coordinates on zones/cities
// (migration 20261014140000), the local gazetteer (mx-places.ts) and an
// optional geocoder (geo.ts), the search ranks the bookable offices of the
// specialty by straight-line distance to where the patient is — across
// catalog cities (CDMX and Estado de México are one metro area) — so the
// agent can offer "no tengo en Chimalhuacán, pero tengo en Roma, Naucalpan…".

/** Metro-area radius: beyond this an office is not "nearby", the nearest city is offered instead. */
export const NEARBY_MAX_KM = 60;
export const NEARBY_LIMIT = 5;
/** A gazetteer hit farther than this from the city the patient named is ignored (homonyms). */
const GAZETTEER_CITY_GUARD_KM = 150;
/** Catalog zones that name a direction, not a place: never matched from free text. */
const GENERIC_ZONE_NAMES = new Set(["norte", "sur", "oriente", "poniente", "centro", "centro poniente", "centro norte", "centro sur"]);

export type OriginSource = "catalog_zone" | "catalog_city" | "gazetteer" | "geocoder";

export interface SearchOrigin {
  point: GeoPoint;
  /** Human name of the place ("Chimalhuacán", "Roma"). */
  label: string;
  source: OriginSource;
  /** Catalog zones that ARE the requested place (any city), to mark in_requested_zone. */
  zone_ids: string[];
}

interface ZoneGeoRow {
  id: string;
  name: string;
  city_id: string | null;
  latitude: unknown;
  longitude: unknown;
}

interface CityGeoRow {
  id: string;
  name: string;
  latitude: unknown;
  longitude: unknown;
}

/** Catalog zones named by free text: exact name, or a specific (non-directional) zone name inside the text. */
export function matchCatalogZones<T extends { name: string }>(text: string, zones: T[]): T[] {
  const q = normalizePlace(text).replace(/^(colonia|col|alcaldia|municipio de|municipio|zona) /, "");
  if (!q) return [];
  const exact = zones.filter((z) => normalizePlace(z.name) === q);
  if (exact.length > 0) return exact;
  const padded = ` ${q} `;
  return zones.filter((z) => {
    const n = normalizePlace(z.name);
    // "Observatorio (poniente)" is also found as "observatorio".
    const head = n.split(" ")[0];
    const keys = [n, head].filter((k) => k.length >= 5 && !GENERIC_ZONE_NAMES.has(k));
    return keys.some((k) => padded.includes(` ${k} `));
  });
}

/**
 * Where is the patient? Zone text first (catalog zone with coordinates →
 * gazetteer → geocoder), else the resolved city's coordinates, else the city
 * text itself as a place (a municipality said as "city": "Neza"). null when
 * nothing gives a point: the caller asks instead of guessing.
 */
export async function resolveSearchOrigin(
  supabase: SupabaseClient,
  input: { zoneText?: string | null; cityText?: string | null; city?: Place | null; geocode?: boolean },
): Promise<SearchOrigin | null> {
  const [{ data: zr }, { data: cr }] = await Promise.all([
    supabase.from("zones").select("id, name, city_id, latitude, longitude"),
    supabase.from("cities").select("id, name, latitude, longitude"),
  ]);
  const zones = (zr ?? []) as ZoneGeoRow[];
  const cities = (cr ?? []) as CityGeoRow[];
  const city = input.city ?? null;
  const cityRow = city ? cities.find((c) => c.id === city.id) ?? null : null;
  const cityPoint = cityRow ? toPoint(cityRow.latitude, cityRow.longitude) : null;
  const useGeocoder = input.geocode !== false;

  const fromText = async (text: string, contextCity: string | null): Promise<SearchOrigin | null> => {
    const matched = matchCatalogZones(text, zones);
    const inCity = city ? matched.filter((z) => z.city_id === city.id) : [];
    const ordered = [...inCity, ...matched.filter((z) => !inCity.includes(z))];
    const zoneIds = matched.map((z) => z.id);
    for (const z of ordered) {
      const p = toPoint(z.latitude, z.longitude);
      if (p) return { point: p, label: z.name, source: "catalog_zone", zone_ids: zoneIds };
    }
    const gaz = findMxPlace(text);
    if (gaz && (!cityPoint || haversineKm(cityPoint, gaz) <= GAZETTEER_CITY_GUARD_KM)) {
      return { point: { lat: gaz.lat, lon: gaz.lon }, label: gaz.name, source: "gazetteer", zone_ids: zoneIds };
    }
    if (useGeocoder) {
      const q = contextCity ? `${text}, ${contextCity}` : text;
      const hit = await geocodeMx(supabase, q, { near: cityPoint });
      if (hit) return { point: { lat: hit.lat, lon: hit.lon }, label: text.trim(), source: "geocoder", zone_ids: zoneIds };
    }
    return null;
  };

  const zoneText = input.zoneText?.trim();
  if (zoneText) return await fromText(zoneText, city?.name ?? input.cityText ?? null);
  if (city) return cityPoint ? { point: cityPoint, label: city.name, source: "catalog_city", zone_ids: [] } : null;
  const cityText = input.cityText?.trim();
  return cityText ? await fromText(cityText, null) : null;
}

export interface NearbyCareOption extends CareOption {
  /** Rounded straight-line km. */
  distance_km: number;
  /** "zone": the office zone has coordinates; "city": only its city's (approximate). */
  distance_basis: "zone" | "city";
  in_requested_zone: boolean;
}

export type NearbySearchResult =
  | {
    ok: true;
    matched_specialties: string[];
    /** Within maxKm: requested zone first, then precise (zone) before approximate (city), nearest first. */
    options: NearbyCareOption[];
    /** Offices of the specialty that could / could not be placed on the map. */
    located_offices: number;
    unlocated_offices: number;
    /** Cities with options beyond maxKm, nearest first (only when nothing is within maxKm). */
    nearest_cities_beyond: { city_id: string; city: string; distance_km: number; options: number }[];
  }
  | { ok: false; error: "query_error"; message: string };

type OfficeRow = {
  id: string;
  doctor_id: string;
  name: string;
  address: string | null;
  city_id: string | null;
  zone_id: string | null;
  doctors: { id: string; full_name: string; phone: string | null };
};

/**
 * Bookable offices (active office of an active doctor) of a specialty ranked
 * by distance to `origin`, in any catalog city.
 */
export async function searchNearbyCareOptions(
  supabase: SupabaseClient,
  input: { especialidad: string; origin: GeoPoint; requestedZoneIds?: string[]; maxKm?: number; limit?: number },
): Promise<NearbySearchResult> {
  const maxKm = input.maxKm ?? NEARBY_MAX_KM;
  const limit = input.limit ?? NEARBY_LIMIT;
  const requested = new Set(input.requestedZoneIds ?? []);
  const isRequested = (o: OfficeRow) => o.zone_id !== null && requested.has(o.zone_id);

  const stem = specialtyStem(input.especialidad);
  const { data: specRows, error: specErr } = await supabase
    .from("doctor_specialties")
    .select("doctor_id, specialties!inner(name)")
    .ilike("specialties.name", `%${stem}%`);
  if (specErr) return { ok: false, error: "query_error", message: "specialties" };
  const specMatches = (specRows ?? []) as unknown as { doctor_id: string; specialties: { name: string } }[];
  const matched = [...new Set(specMatches.map((m) => m.specialties?.name).filter(Boolean))];
  const doctorIds = [...new Set(specMatches.map((m) => m.doctor_id))];
  const empty: NearbySearchResult = { ok: true, matched_specialties: matched, options: [], located_offices: 0, unlocated_offices: 0, nearest_cities_beyond: [] };
  if (doctorIds.length === 0) return empty;

  const { data: officeRows, error: officeErr } = await supabase
    .from("doctor_offices")
    .select("id, doctor_id, name, address, city_id, zone_id, doctors!inner(id, full_name, phone, is_active, is_deleted)")
    .eq("is_active", true)
    .eq("is_deleted", false)
    .in("doctor_id", doctorIds)
    .eq("doctors.is_active", true)
    .eq("doctors.is_deleted", false);
  if (officeErr) return { ok: false, error: "query_error", message: "offices" };
  const offices = (officeRows ?? []) as unknown as OfficeRow[];
  if (offices.length === 0) return empty;

  const zoneIds = [...new Set(offices.map((o) => o.zone_id).filter((z): z is string => !!z))];
  const cityIds = [...new Set(offices.map((o) => o.city_id).filter((c): c is string => !!c))];
  const [zq, cq] = await Promise.all([
    zoneIds.length > 0 ? supabase.from("zones").select("id, name, city_id, latitude, longitude").in("id", zoneIds) : null,
    cityIds.length > 0 ? supabase.from("cities").select("id, name, latitude, longitude").in("id", cityIds) : null,
  ]);
  if (zq?.error || cq?.error) return { ok: false, error: "query_error", message: "catalog" };
  const zoneById = new Map(((zq?.data ?? []) as ZoneGeoRow[]).map((z) => [z.id, z]));
  const cityById = new Map(((cq?.data ?? []) as CityGeoRow[]).map((c) => [c.id, c]));

  const placed: { o: OfficeRow; km: number; basis: "zone" | "city" }[] = [];
  let unlocated = 0;
  for (const o of offices) {
    const z = o.zone_id ? zoneById.get(o.zone_id) : undefined;
    const c = o.city_id ? cityById.get(o.city_id) : undefined;
    const zp = z ? toPoint(z.latitude, z.longitude) : null;
    const cp = c ? toPoint(c.latitude, c.longitude) : null;
    const p = zp ?? cp;
    if (!p) {
      unlocated++;
      continue;
    }
    placed.push({ o, km: haversineKm(input.origin, p), basis: zp ? "zone" : "city" });
  }

  const within = placed
    .filter((x) => x.km <= maxKm || isRequested(x.o))
    .sort((a, b) =>
      Number(isRequested(b.o)) - Number(isRequested(a.o)) ||
      (a.basis === b.basis ? 0 : a.basis === "zone" ? -1 : 1) ||
      a.km - b.km ||
      a.o.doctors.full_name.localeCompare(b.o.doctors.full_name)
    )
    .slice(0, limit);

  let beyond: { city_id: string; city: string; distance_km: number; options: number }[] = [];
  if (within.length === 0) {
    const byCity = new Map<string, { km: number; n: number }>();
    for (const x of placed) {
      if (!x.o.city_id) continue;
      const cur = byCity.get(x.o.city_id);
      byCity.set(x.o.city_id, { km: Math.min(cur?.km ?? Infinity, x.km), n: (cur?.n ?? 0) + 1 });
    }
    beyond = [...byCity.entries()]
      .filter(([id]) => cityById.has(id))
      .map(([id, v]) => ({ city_id: id, city: cityById.get(id)!.name, distance_km: roundKm(v.km), options: v.n }))
      .sort((a, b) => a.distance_km - b.distance_km || b.options - a.options)
      .slice(0, 3);
  }

  const specsByDoctor: Record<string, string[]> = {};
  const usedDoctors = [...new Set(within.map((x) => x.o.doctor_id))];
  if (usedDoctors.length > 0) {
    const { data: allSpecs } = await supabase.from("doctor_specialties").select("doctor_id, specialties(name)").in("doctor_id", usedDoctors);
    for (const row of (allSpecs ?? []) as unknown as { doctor_id: string; specialties: { name: string } | null }[]) {
      if (!row.specialties?.name) continue;
      (specsByDoctor[row.doctor_id] ??= []).push(row.specialties.name);
    }
  }

  return {
    ok: true,
    matched_specialties: matched,
    options: within.map(({ o, km, basis }) => ({
      doctor_id: o.doctors.id,
      doctor_name: o.doctors.full_name,
      doctor_phone: o.doctors.phone,
      specialties: specsByDoctor[o.doctors.id] ?? [],
      office_id: o.id,
      office_name: o.name,
      office_address: o.address,
      city: o.city_id ? cityById.get(o.city_id)?.name ?? null : null,
      zone: o.zone_id ? zoneById.get(o.zone_id)?.name ?? null : null,
      distance_km: roundKm(km),
      distance_basis: basis,
      in_requested_zone: isRequested(o),
    })),
    located_offices: placed.length,
    unlocated_offices: unlocated,
    nearest_cities_beyond: beyond,
  };
}
