// Geography helpers for "nearest options" (search_care_options):
//   * haversineKm / roundKm — straight-line distance between two points;
//   * geocodeMx — optional fallback for places that are neither in the catalog
//     nor in the local gazetteer (_shared/mx-places.ts): Nominatim
//     (OpenStreetMap), limited to Mexico, 3 s timeout, own User-Agent, results
//     cached in public.geo_cache (also "not found", retried after 30 days).
//     Any failure returns null and the search continues without coordinates.
//
// Nominatim usage policy: max 1 request/s, identifying User-Agent, cache the
// results. The cache plus "only when everything else failed" keeps FindMed far
// below that. Disable with the function secret FINDMED_GEOCODER=off.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePlace } from "./mx-places.ts";

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Inside Mexico's bounding box (same range as the DB CHECK on zones/cities). */
export function isInMexico(p: { lat: number; lon: number }): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat >= 14 && p.lat <= 33 && p.lon >= -119 && p.lon <= -86;
}

/** Point from nullable numeric columns (supabase returns numeric as number or string). */
export function toPoint(lat: unknown, lon: unknown): GeoPoint | null {
  if (lat === null || lat === undefined || lon === null || lon === undefined || lat === "" || lon === "") return null;
  const p = { lat: Number(lat), lon: Number(lon) };
  return isInMexico(p) ? p : null;
}

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance for people: whole km, never "0 km". */
export function roundKm(km: number): number {
  return Math.max(1, Math.round(km));
}

// --- Geocoder (Nominatim + geo_cache) ------------------------------------------

export const GEOCODER_USER_AGENT = "FindMed/1.0 (+https://app.findmed.com.mx; agenda de citas medicas)";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const GEOCODER_TIMEOUT_MS = 3_000;
const NEGATIVE_TTL_MS = 30 * 24 * 3_600_000;

export interface GeocodeHit extends GeoPoint {
  label: string;
}

export interface GeocodeOptions {
  /** Bias (and bound) the search to ~65 km around this point, e.g. the patient's city. */
  near?: GeoPoint | null;
  /** Defaults to env FINDMED_GEOCODER != "off". */
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  now?: number;
}

export function geocoderEnabled(): boolean {
  try {
    return (Deno.env.get("FINDMED_GEOCODER") ?? "").trim().toLowerCase() !== "off";
  } catch {
    return false;
  }
}

export function geoCacheKey(query: string, near?: GeoPoint | null): string {
  const base = normalizePlace(query).slice(0, 160);
  return near ? `${base}@${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : base;
}

/**
 * Free text → approximate point in Mexico, or null. Never throws. Cached in
 * geo_cache (service role writes; admins can read it).
 */
export async function geocodeMx(supabase: SupabaseClient, query: string, opts: GeocodeOptions = {}): Promise<GeocodeHit | null> {
  const enabled = opts.enabled ?? geocoderEnabled();
  const text = String(query ?? "").trim();
  if (!enabled || normalizePlace(text).length < 3) return null;
  const key = geoCacheKey(text, opts.near);
  const now = opts.now ?? Date.now();

  type CacheRow = { found: boolean; latitude: unknown; longitude: unknown; display_name: string | null; created_at: string };
  const readCache = async (): Promise<CacheRow | null> => {
    try {
      const { data } = await supabase
        .from("geo_cache")
        .select("found, latitude, longitude, display_name, created_at")
        .eq("query_key", key)
        .maybeSingle();
      return (data as CacheRow | null) ?? null;
    } catch {
      return null; // cache is best-effort
    }
  };
  const cachedRow = await readCache();
  if (cachedRow) {
    if (cachedRow.found) {
      const p = toPoint(cachedRow.latitude, cachedRow.longitude);
      if (p) return { ...p, label: cachedRow.display_name ?? text };
    } else if (now - Date.parse(cachedRow.created_at) < NEGATIVE_TTL_MS) {
      return null;
    }
  }

  const params = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "mx", "accept-language": "es", q: text });
  if (opts.near) {
    const d = 0.6; // ≈ 65 km
    params.set("viewbox", `${opts.near.lon - d},${opts.near.lat + d},${opts.near.lon + d},${opts.near.lat - d}`);
    params.set("bounded", "1");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODER_TIMEOUT_MS);
  let hit: GeocodeHit | null = null;
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${NOMINATIM_URL}?${params}`, {
      headers: { "User-Agent": GEOCODER_USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null; // transient (429/5xx): don't cache
    const body = await res.json();
    const first = Array.isArray(body) ? body[0] : null;
    const p = first ? toPoint(first.lat, first.lon) : null;
    if (p) {
      const label = String(first.display_name ?? text).split(",")[0].trim() || text;
      hit = { ...p, label };
    }
  } catch {
    return null; // timeout / network / bad JSON: don't cache
  } finally {
    clearTimeout(timer);
  }

  const row = {
    query_key: key,
    query: text.slice(0, 200),
    found: !!hit,
    latitude: hit ? Number(hit.lat.toFixed(6)) : null,
    longitude: hit ? Number(hit.lon.toFixed(6)) : null,
    display_name: hit?.label ?? null,
    provider: "nominatim",
    created_at: new Date(now).toISOString(),
  };
  try {
    if (cachedRow) await supabase.from("geo_cache").update(row).eq("query_key", key);
    else await supabase.from("geo_cache").insert(row);
  } catch { /* best-effort */ }
  return hit;
}
