/**
 * Coordenadas aproximadas de zonas y ciudades (Configuración → Catálogos).
 * El agente de WhatsApp las usa para ordenar los consultorios por cercanía
 * (search_care_options). Mismo rango que el CHECK de la migración
 * 20261014140000: dentro de México y siempre la pareja completa.
 */

export const MX_BOUNDS = { minLat: 14, maxLat: 33, minLon: -119, maxLon: -86 } as const;

export type CoordsCheck =
  | { ok: true; latitude: number | null; longitude: number | null }
  | { ok: false; field: "latitude" | "longitude" | "both"; message: string };

/** "19.4170", "19,417" o "" → número o null. NaN si no es número. */
export function parseCoordinate(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  return /^[-+]?\d{1,3}(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/** Valida la pareja latitud/longitud escrita por el admin. Ambas vacías = sin coordenadas. */
export function checkCoordinates(latRaw: string, lonRaw: string): CoordsCheck {
  const latitude = parseCoordinate(latRaw);
  const longitude = parseCoordinate(lonRaw);
  if (latitude === null && longitude === null) return { ok: true, latitude: null, longitude: null };
  if (latitude === null || longitude === null) {
    return { ok: false, field: latitude === null ? "latitude" : "longitude", message: "Escribe latitud y longitud, o deja las dos vacías." };
  }
  if (Number.isNaN(latitude)) return { ok: false, field: "latitude", message: "La latitud debe ser un número, p. ej. 19.4170." };
  if (Number.isNaN(longitude)) return { ok: false, field: "longitude", message: "La longitud debe ser un número, p. ej. -99.1600." };
  const latIn = latitude >= MX_BOUNDS.minLat && latitude <= MX_BOUNDS.maxLat;
  const lonIn = longitude >= MX_BOUNDS.minLon && longitude <= MX_BOUNDS.maxLon;
  if (!latIn && !lonIn && longitude >= MX_BOUNDS.minLat && longitude <= MX_BOUNDS.maxLat) {
    return { ok: false, field: "both", message: "Parece que la latitud y la longitud están invertidas." };
  }
  if (!latIn) return { ok: false, field: "latitude", message: `La latitud debe estar entre ${MX_BOUNDS.minLat} y ${MX_BOUNDS.maxLat} (México).` };
  if (!lonIn) {
    return {
      ok: false,
      field: "longitude",
      message: longitude > 0
        ? "En México la longitud es negativa (p. ej. -99.1600)."
        : `La longitud debe estar entre ${MX_BOUNDS.minLon} y ${MX_BOUNDS.maxLon} (México).`,
    };
  }
  // Seis decimales (~10 cm) es lo que guarda la columna numeric(9,6).
  return { ok: true, latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
}

export type CoordsPatch = { latitude: number | null; longitude: number | null };

/** Valores listos para guardar, o null si la pareja escrita no es válida. */
export function toCoordsPatch(text: { latitude: string; longitude: string }): CoordsPatch | null {
  const c = checkCoordinates(text.latitude, text.longitude);
  return c.ok ? { latitude: c.latitude, longitude: c.longitude } : null;
}

export function hasCoordinates(row: { latitude?: number | null; longitude?: number | null }): boolean {
  return row.latitude !== null && row.latitude !== undefined && row.longitude !== null && row.longitude !== undefined;
}

/** Enlace de OpenStreetMap centrado en el punto (sin librerías de mapas). */
export function mapUrl(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`;
}

/** Texto inicial del campo a partir del valor guardado. */
export function coordinateText(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}
