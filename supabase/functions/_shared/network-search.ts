// Hospitals and laboratories of the FindMed network by location — MCP tools
// find_network_hospitals / find_network_laboratories (FindMed decision c:
// in an "urgencias_hoy" route the agent shares 1–3 network hospitals in the
// patient's city, then opens an urgent case and hands off to a person).
//
// Same location rules as care-search.ts: accent/case-insensitive, city
// aliases (CDMX, DF, Edomex…), ambiguous text is asked back, never guessed.
// One addition: when the text is not a city but a zone of the catalog
// ("Naucalpan", "Satélite"), it resolves to that zone and its city.
//
// Only catalog data is returned (name, address, phone, zone, city). A missing
// phone stays null: the agent must not make one up. The catalogs have no
// coordinates, so "nearest" cities can't be computed: when the city has no
// network place, the other cities that do have one are listed and the caller
// is told to escalate.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CITY_ALIASES, type Place, resolvePlace } from "./care-search.ts";

export type NetworkKind = "hospitals" | "laboratories";

export interface NetworkPlace {
  name: string;
  address: string | null;
  phone: string | null;
  zone: string | null;
  city: string | null;
  /** true when it is in the zone the patient gave (null if no zone was given/matched). */
  in_requested_zone: boolean | null;
}

export type NetworkReason = "unknown_city" | "ambiguous_city" | "none_in_city";

export type NetworkSearchResult =
  | {
    ok: true;
    result: "none" | "one" | "many";
    reason: NetworkReason | null;
    city: string | null;
    zone: string | null;
    zone_matched: boolean | null;
    city_candidates: string[];
    places: NetworkPlace[];
    /** Other cities with network places (most first), when this one has none or is unknown. */
    other_cities: { city: string; count: number }[];
  }
  | { ok: false; error: "query_error"; message: string };

export const NETWORK_DEFAULT_LIMIT = 3;
export const NETWORK_MAX_LIMIT = 5;

interface ZoneRow extends Place {
  city_id: string;
}

interface PlaceRow {
  name: string;
  address: string | null;
  phone: string | null;
  city_id: string | null;
  zone_id: string | null;
}

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export async function findNetworkPlaces(
  supabase: SupabaseClient,
  kind: NetworkKind,
  input: { city: string; zone?: string | null; limit?: number | null },
): Promise<NetworkSearchResult> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? NETWORK_DEFAULT_LIMIT), 1), NETWORK_MAX_LIMIT);

  const [{ data: cityRows, error: cityErr }, { data: zoneRows, error: zoneErr }] = await Promise.all([
    supabase.from("cities").select("id, name"),
    supabase.from("zones").select("id, name, city_id"),
  ]);
  if (cityErr || zoneErr) return { ok: false, error: "query_error", message: "catalog" };
  const cities = (cityRows ?? []) as Place[];
  const zones = (zoneRows ?? []) as ZoneRow[];
  const cityName = Object.fromEntries(cities.map((c) => [c.id, c.name]));
  const zoneName = Object.fromEntries(zones.map((z) => [z.id, z.name]));

  // Other cities that have network places (used for "none" answers).
  const otherCities = async (exclude: string[]) => {
    const { data } = await supabase.from(kind).select("city_id").eq("is_active", true);
    const counts = new Map<string, number>();
    for (const r of (data ?? []) as { city_id: string | null }[]) {
      if (!r.city_id || exclude.includes(r.city_id) || !cityName[r.city_id]) continue;
      counts.set(r.city_id, (counts.get(r.city_id) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ city: cityName[id], count }))
      .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  };

  const none = async (reason: NetworkReason, extra: { city?: string | null; candidates?: string[]; exclude?: string[] } = {}): Promise<NetworkSearchResult> => ({
    ok: true,
    result: "none",
    reason,
    city: extra.city ?? null,
    zone: null,
    zone_matched: null,
    city_candidates: extra.candidates ?? [],
    places: [],
    other_cities: reason === "ambiguous_city" ? [] : await otherCities(extra.exclude ?? []),
  });

  // 1. City; if the text is not a city, maybe it is a zone of the catalog.
  let cityIds: string[];
  let zoneIds: string[] = [];
  const city = resolvePlace(input.city, cities, "ambiguous", CITY_ALIASES);
  if (city.kind === "ambiguous") return none("ambiguous_city", { candidates: city.candidates.map((c) => c.name) });
  if (city.kind === "match") {
    cityIds = city.places.map((c) => c.id);
  } else {
    const asZone = resolvePlace(input.city, zones, "union");
    if (asZone.kind !== "match") return none("unknown_city");
    const zoneCities = [...new Set((asZone.places as ZoneRow[]).map((z) => z.city_id))];
    if (zoneCities.length > 1) {
      return none("ambiguous_city", { candidates: zoneCities.map((id) => cityName[id]).filter(Boolean) });
    }
    cityIds = zoneCities;
    zoneIds = asZone.places.map((z) => z.id);
  }
  const cityOut = cityName[cityIds[0]] ?? null;

  // 2. Optional zone inside that city: it only orders the results (closest
  // first); an unknown zone never empties the answer.
  let zoneMatched: boolean | null = zoneIds.length > 0 ? true : null;
  if (input.zone && input.zone.trim()) {
    const inCity = zones.filter((z) => cityIds.includes(z.city_id));
    const zone = resolvePlace(input.zone, inCity, "union");
    if (zone.kind === "match") {
      zoneIds = zone.places.map((z) => z.id);
      zoneMatched = true;
    } else if (zoneIds.length === 0) {
      zoneMatched = false;
    }
  }

  // 3. Active places of the network in that city.
  const { data: rows, error } = await supabase
    .from(kind)
    .select("name, address, phone, city_id, zone_id")
    .eq("is_active", true)
    .in("city_id", cityIds);
  if (error) return { ok: false, error: "query_error", message: kind };
  const all = (rows ?? []) as PlaceRow[];
  if (all.length === 0) return none("none_in_city", { city: cityOut, exclude: cityIds });

  const inZone = (r: PlaceRow) => zoneIds.length > 0 && !!r.zone_id && zoneIds.includes(r.zone_id);
  const places = [...all]
    .sort((a, b) => Number(inZone(b)) - Number(inZone(a)) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((r) => ({
      name: r.name,
      address: clean(r.address),
      phone: clean(r.phone),
      zone: r.zone_id ? zoneName[r.zone_id] ?? null : null,
      city: r.city_id ? cityName[r.city_id] ?? null : null,
      in_requested_zone: zoneIds.length > 0 ? inZone(r) : null,
    }));

  return {
    ok: true,
    result: places.length === 1 ? "one" : "many",
    reason: null,
    city: cityOut,
    zone: zoneIds.length > 0 ? zoneName[zoneIds[0]] ?? null : null,
    zone_matched: zoneMatched,
    city_candidates: [],
    places,
    other_cities: [],
  };
}
