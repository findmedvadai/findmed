// Local gazetteer for the places patients actually say on WhatsApp: the 16
// alcaldías of CDMX, the most populated municipalities of the Estado de México
// metro area (and the Toluca valley), the most common CDMX colonias/zones and
// the cities of the FindMed catalog plus nearby big cities.
//
// Why: a patient in Chimalhuacán, Neza or Coyoacán names a place that is not a
// zone of the catalog. Without a point the agent could only say "no tengo
// médicos ahí" and hand off to a person (client complaint, 14-oct-2026). With
// an approximate point, search_care_options ranks the nearest offices.
//
// Coordinates are APPROXIMATE (centroid of the populated area, ±1–2 km), good
// for "a unos 12 km", never for directions. Accuracy of a few km is enough to
// order offices; distances shown to patients are rounded.
//
// Matching is tolerant: case/accents/punctuation-insensitive, strips prefixes
// such as "col.", "colonia", "alcaldía", "municipio de", and trailing state
// qualifiers ("…, Edomex", "… CDMX"). Generic words that are also part of
// other names ("Lomas", "Juárez", "Doctores") only match exactly.
//
// Pure data + pure functions: no I/O, no imports (safe to use anywhere).

export type MxPlaceKind = "colonia" | "alcaldia" | "municipio" | "ciudad";

export interface MxPlace {
  name: string;
  kind: MxPlaceKind;
  /** State, for display ("Ciudad de México", "Estado de México", "Jalisco"…). */
  state: string;
  /** FindMed catalog city this place belongs to commercially (may not exist in the catalog). */
  city: string;
  lat: number;
  lon: number;
  /** Extra spellings; matched exactly and as whole words inside longer text. */
  aliases?: string[];
  /** Spellings that only match the WHOLE input (too generic to find inside text). */
  exact?: string[];
  /** true → the name itself only matches exactly (e.g. "Juárez", "Doctores"). */
  strict?: boolean;
}

const CDMX = "Ciudad de México";
const EDOMEX = "Estado de México";

export const MX_PLACES: readonly MxPlace[] = [
  // --- CDMX: 16 alcaldías (populated area) ------------------------------------
  { name: "Álvaro Obregón", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.359, lon: -99.21 },
  { name: "Azcapotzalco", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.487, lon: -99.186 },
  { name: "Benito Juárez", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.372, lon: -99.158, exact: ["bj"] },
  { name: "Coyoacán", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.33, lon: -99.158 },
  { name: "Cuajimalpa", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.357, lon: -99.299, aliases: ["cuajimalpa de morelos"] },
  { name: "Cuauhtémoc", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.433, lon: -99.149 },
  { name: "Gustavo A. Madero", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.49, lon: -99.11, aliases: ["gustavo madero"], exact: ["gam"] },
  { name: "Iztacalco", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.396, lon: -99.097 },
  { name: "Iztapalapa", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.357, lon: -99.056 },
  { name: "La Magdalena Contreras", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.318, lon: -99.237, aliases: ["magdalena contreras"], exact: ["contreras"] },
  { name: "Miguel Hidalgo", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.428, lon: -99.2 },
  { name: "Milpa Alta", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.192, lon: -99.023 },
  { name: "Tláhuac", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.286, lon: -99.005 },
  { name: "Tlalpan", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.295, lon: -99.165 },
  { name: "Venustiano Carranza", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.43, lon: -99.1 },
  { name: "Xochimilco", kind: "alcaldia", state: CDMX, city: CDMX, lat: 19.262, lon: -99.105 },

  // --- Estado de México: metro area municipalities ---------------------------
  { name: "Nezahualcóyotl", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.401, lon: -99.015, aliases: ["ciudad neza", "cd neza", "ciudad nezahualcoyotl"], exact: ["neza"] },
  { name: "Chimalhuacán", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.421, lon: -98.954, exact: ["chimal"] },
  { name: "Ecatepec", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.601, lon: -99.05, aliases: ["ecatepec de morelos"] },
  { name: "Naucalpan", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.478, lon: -99.239, aliases: ["naucalpan de juarez"] },
  { name: "Tlalnepantla", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.54, lon: -99.195, aliases: ["tlalnepantla de baz"], exact: ["tlalne"] },
  // Populated area (Interlomas / Bosques / Jesús del Monte), not the municipal seat further west.
  { name: "Huixquilucan", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.39, lon: -99.29, aliases: ["huixquilucan de degollado"] },
  { name: "Atizapán de Zaragoza", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.559, lon: -99.267, aliases: ["atizapan"] },
  { name: "Cuautitlán Izcalli", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.646, lon: -99.215, aliases: ["izcalli"] },
  { name: "Cuautitlán", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.67, lon: -99.179, aliases: ["cuautitlan mexico"] },
  { name: "Tecámac", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.713, lon: -98.968, aliases: ["tecamac de felipe villanueva"] },
  { name: "Texcoco", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.511, lon: -98.882, aliases: ["texcoco de mora"] },
  { name: "La Paz", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.36, lon: -98.98, aliases: ["los reyes la paz", "los reyes acaquilpan"], strict: true },
  { name: "Chalco", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.264, lon: -98.897, aliases: ["chalco de diaz covarrubias"] },
  { name: "Valle de Chalco", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.293, lon: -98.94, aliases: ["valle de chalco solidaridad"] },
  { name: "Ixtapaluca", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.318, lon: -98.882 },
  { name: "Coacalco", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.631, lon: -99.108, aliases: ["coacalco de berriozabal"] },
  { name: "Tultitlán", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.645, lon: -99.169, aliases: ["tultitlan de mariano escobedo"] },
  { name: "Nicolás Romero", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.621, lon: -99.314, aliases: ["ciudad nicolas romero"] },
  { name: "Tultepec", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.685, lon: -99.128 },
  { name: "Zumpango", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.796, lon: -99.099, aliases: ["zumpango de ocampo"] },
  { name: "Chicoloapan", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.416, lon: -98.902, aliases: ["chicoloapan de juarez"] },
  { name: "Acolman", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.637, lon: -98.912 },
  { name: "Huehuetoca", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.834, lon: -99.203 },
  { name: "Tepotzotlán", kind: "municipio", state: EDOMEX, city: EDOMEX, lat: 19.713, lon: -99.223 },
  // Toluca valley (commercially, the catalog city Toluca).
  { name: "Metepec", kind: "municipio", state: EDOMEX, city: "Toluca", lat: 19.251, lon: -99.604 },
  { name: "Zinacantepec", kind: "municipio", state: EDOMEX, city: "Toluca", lat: 19.284, lon: -99.733 },
  { name: "Lerma", kind: "municipio", state: EDOMEX, city: "Toluca", lat: 19.285, lon: -99.511, aliases: ["lerma de villada"] },
  { name: "San Mateo Atenco", kind: "municipio", state: EDOMEX, city: "Toluca", lat: 19.267, lon: -99.533 },
  { name: "Ocoyoacac", kind: "municipio", state: EDOMEX, city: "Toluca", lat: 19.274, lon: -99.46 },

  // --- Common colonias / zones (CDMX and the western/northern metro) ---------
  { name: "Roma", kind: "colonia", state: CDMX, city: CDMX, lat: 19.417, lon: -99.16, aliases: ["roma norte", "roma sur"] },
  { name: "Condesa", kind: "colonia", state: CDMX, city: CDMX, lat: 19.411, lon: -99.173, aliases: ["hipodromo condesa", "hipodromo"] },
  { name: "Polanco", kind: "colonia", state: CDMX, city: CDMX, lat: 19.433, lon: -99.195 },
  { name: "Del Valle", kind: "colonia", state: CDMX, city: CDMX, lat: 19.383, lon: -99.165, aliases: ["del valle centro", "del valle norte", "del valle sur"] },
  { name: "Narvarte", kind: "colonia", state: CDMX, city: CDMX, lat: 19.392, lon: -99.152, aliases: ["narvarte poniente", "narvarte oriente"] },
  { name: "Nápoles", kind: "colonia", state: CDMX, city: CDMX, lat: 19.394, lon: -99.177 },
  { name: "Coyoacán centro", kind: "colonia", state: CDMX, city: CDMX, lat: 19.35, lon: -99.162, aliases: ["centro de coyoacan"] },
  { name: "Santa Fe", kind: "colonia", state: CDMX, city: CDMX, lat: 19.36, lon: -99.26, aliases: ["zedec santa fe"] },
  { name: "Interlomas", kind: "colonia", state: EDOMEX, city: EDOMEX, lat: 19.397, lon: -99.28 },
  { name: "Ciudad Satélite", kind: "colonia", state: EDOMEX, city: EDOMEX, lat: 19.51, lon: -99.235, aliases: ["satelite", "cd satelite", "plaza satelite"] },
  { name: "Lomas Verdes", kind: "colonia", state: EDOMEX, city: EDOMEX, lat: 19.506, lon: -99.265 },
  { name: "Tecamachalco", kind: "colonia", state: EDOMEX, city: EDOMEX, lat: 19.425, lon: -99.245, aliases: ["lomas de tecamachalco"] },
  { name: "Lindavista", kind: "colonia", state: CDMX, city: CDMX, lat: 19.489, lon: -99.129, aliases: ["linda vista"] },
  { name: "Pedregal", kind: "colonia", state: CDMX, city: CDMX, lat: 19.315, lon: -99.205, aliases: ["jardines del pedregal", "pedregal de san angel"] },
  { name: "San Ángel", kind: "colonia", state: CDMX, city: CDMX, lat: 19.346, lon: -99.19, aliases: ["san angel inn"] },
  { name: "Tlalpan centro", kind: "colonia", state: CDMX, city: CDMX, lat: 19.29, lon: -99.168, aliases: ["centro de tlalpan"] },
  { name: "Doctores", kind: "colonia", state: CDMX, city: CDMX, lat: 19.42, lon: -99.144, aliases: ["colonia doctores"], strict: true },
  { name: "Juárez", kind: "colonia", state: CDMX, city: CDMX, lat: 19.427, lon: -99.161, aliases: ["colonia juarez", "zona rosa"], strict: true },
  { name: "Escandón", kind: "colonia", state: CDMX, city: CDMX, lat: 19.403, lon: -99.18 },
  { name: "Tacubaya", kind: "colonia", state: CDMX, city: CDMX, lat: 19.402, lon: -99.188 },
  { name: "Mixcoac", kind: "colonia", state: CDMX, city: CDMX, lat: 19.375, lon: -99.188 },
  { name: "Insurgentes Mixcoac", kind: "colonia", state: CDMX, city: CDMX, lat: 19.372, lon: -99.183 },
  { name: "Lomas de Chapultepec", kind: "colonia", state: CDMX, city: CDMX, lat: 19.425, lon: -99.215, exact: ["lomas", "las lomas"] },
  { name: "Bosques de las Lomas", kind: "colonia", state: CDMX, city: CDMX, lat: 19.388, lon: -99.249 },
  { name: "Anzures", kind: "colonia", state: CDMX, city: CDMX, lat: 19.429, lon: -99.18 },
  { name: "Observatorio", kind: "colonia", state: CDMX, city: CDMX, lat: 19.403, lon: -99.2 },
  { name: "Centro Histórico", kind: "colonia", state: CDMX, city: CDMX, lat: 19.4326, lon: -99.1332, aliases: ["zocalo", "centro cdmx"] },
  { name: "Tlatelolco", kind: "colonia", state: CDMX, city: CDMX, lat: 19.451, lon: -99.137, aliases: ["nonoalco tlatelolco"] },
  { name: "Santa María la Ribera", kind: "colonia", state: CDMX, city: CDMX, lat: 19.45, lon: -99.16 },
  { name: "San Rafael", kind: "colonia", state: CDMX, city: CDMX, lat: 19.438, lon: -99.16, strict: true },
  { name: "Portales", kind: "colonia", state: CDMX, city: CDMX, lat: 19.368, lon: -99.145 },
  { name: "Villa Coapa", kind: "colonia", state: CDMX, city: CDMX, lat: 19.297, lon: -99.127, aliases: ["coapa"] },
  { name: "Ciudad Universitaria", kind: "colonia", state: CDMX, city: CDMX, lat: 19.324, lon: -99.187, exact: ["cu"] },
  { name: "Copilco", kind: "colonia", state: CDMX, city: CDMX, lat: 19.337, lon: -99.177 },
  { name: "Taxqueña", kind: "colonia", state: CDMX, city: CDMX, lat: 19.344, lon: -99.143, aliases: ["tasquena"] },
  { name: "Churubusco", kind: "colonia", state: CDMX, city: CDMX, lat: 19.355, lon: -99.146 },
  { name: "Tacuba", kind: "colonia", state: CDMX, city: CDMX, lat: 19.459, lon: -99.189 },
  { name: "Clavería", kind: "colonia", state: CDMX, city: CDMX, lat: 19.467, lon: -99.183 },
  { name: "San Juan de Aragón", kind: "colonia", state: CDMX, city: CDMX, lat: 19.46, lon: -99.075, exact: ["aragon"] },

  // --- Cities (catalog + nearby big cities) ----------------------------------
  {
    name: "Ciudad de México", kind: "ciudad", state: CDMX, city: CDMX, lat: 19.4326, lon: -99.1332,
    aliases: ["cdmx", "cd mx", "cd de mexico", "ciudad mexico", "distrito federal", "mexico df", "mexico city"], exact: ["df", "d f"],
  },
  { name: "Querétaro", kind: "ciudad", state: "Querétaro", city: "Querétaro", lat: 20.5888, lon: -100.3899, aliases: ["santiago de queretaro"], exact: ["qro"] },
  { name: "Guadalajara", kind: "ciudad", state: "Jalisco", city: "Guadalajara", lat: 20.6597, lon: -103.3496, exact: ["gdl"] },
  { name: "Toluca", kind: "ciudad", state: EDOMEX, city: "Toluca", lat: 19.2826, lon: -99.6557, aliases: ["toluca de lerdo"] },
  { name: "Aguascalientes", kind: "ciudad", state: "Aguascalientes", city: "Aguascalientes", lat: 21.8818, lon: -102.2916, exact: ["ags"] },
  { name: "Veracruz", kind: "ciudad", state: "Veracruz", city: "Veracruz", lat: 19.1738, lon: -96.1342, aliases: ["puerto de veracruz"] },
  { name: "Guanajuato", kind: "ciudad", state: "Guanajuato", city: "Guanajuato", lat: 21.019, lon: -101.2574 },
  { name: "León", kind: "ciudad", state: "Guanajuato", city: "León", lat: 21.125, lon: -101.686, aliases: ["leon guanajuato", "leon gto"] },
  { name: "Celaya", kind: "ciudad", state: "Guanajuato", city: "Celaya", lat: 20.5235, lon: -100.8157 },
  { name: "Monterrey", kind: "ciudad", state: "Nuevo León", city: "Monterrey", lat: 25.6866, lon: -100.3161, exact: ["mty"] },
  { name: "Puebla", kind: "ciudad", state: "Puebla", city: "Puebla", lat: 19.0414, lon: -98.2063, aliases: ["puebla de zaragoza"] },
];

/** Lowercase, no accents, only [a-z0-9 ] with single spaces. */
export function normalizePlace(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Leading words that only say what kind of place follows.
const PREFIXES = [
  "colonia", "col", "alcaldia", "delegacion", "deleg", "municipio de", "municipio", "mpio", "mun",
  "fraccionamiento", "fracc", "barrio", "pueblo de", "pueblo", "unidad habitacional", "u h", "por la", "en la", "por", "en",
];
// Trailing qualifiers ("…, Edomex", "… CDMX").
const SUFFIXES = [
  "estado de mexico", "edo de mexico", "edo de mex", "edo mex", "edomex", "ciudad de mexico", "cd de mexico",
  "cdmx", "df", "mexico", "mex",
];

function stripAffixes(q: string): string {
  let out = q;
  for (let changed = true; changed;) {
    changed = false;
    for (const p of PREFIXES) {
      if (out.startsWith(p + " ") && out.length > p.length + 1) {
        out = out.slice(p.length + 1);
        changed = true;
      }
    }
    for (const s of SUFFIXES) {
      if (out.endsWith(" " + s) && out.length > s.length + 1) {
        out = out.slice(0, -(s.length + 1));
        changed = true;
      }
    }
  }
  return out.trim();
}

interface Key {
  key: string;
  place: MxPlace;
  /** May be found inside longer text (whole words). */
  inner: boolean;
}

let INDEX: Map<string, MxPlace> | null = null;
let INNER: Key[] | null = null;

function index() {
  if (INDEX && INNER) return { exact: INDEX, inner: INNER };
  const exact = new Map<string, MxPlace>();
  const inner: Key[] = [];
  for (const place of MX_PLACES) {
    const add = (raw: string, canBeInner: boolean) => {
      const key = normalizePlace(raw);
      if (!key) return;
      if (!exact.has(key)) exact.set(key, place);
      // Short keys ("bj", "cu", "gdl") would match random words.
      if (canBeInner && key.length >= 4) inner.push({ key, place, inner: true });
    };
    add(place.name, !place.strict);
    for (const a of place.aliases ?? []) add(a, true);
    for (const e of place.exact ?? []) add(e, false);
  }
  INDEX = exact;
  INNER = inner;
  return { exact, inner };
}

const KIND_RANK: Record<MxPlaceKind, number> = { colonia: 3, municipio: 2, alcaldia: 2, ciudad: 1 };

/**
 * Finds a place in the gazetteer. Order: the whole text, each comma-separated
 * part (first wins: "Chimalhuacán, Edomex"), each with prefixes/suffixes
 * stripped; then a whole-word search inside the text, most specific kind and
 * longest name first ("Satélite, Naucalpan" → Ciudad Satélite). null when
 * nothing matches.
 */
export function findMxPlace(text: string | null | undefined): MxPlace | null {
  if (!text) return null;
  const { exact, inner } = index();
  const parts = String(text).split(/[,;/()]| - /).map(normalizePlace).filter(Boolean);
  const whole = normalizePlace(String(text));
  const candidates = [whole, ...parts];
  for (const c of candidates) {
    const hit = exact.get(c) ?? exact.get(stripAffixes(c));
    if (hit) return hit;
  }
  if (!whole) return null;
  const padded = ` ${whole} `;
  const found = inner.filter((k) => padded.includes(` ${k.key} `));
  if (found.length === 0) return null;
  found.sort((a, b) => KIND_RANK[b.place.kind] - KIND_RANK[a.place.kind] || b.key.length - a.key.length);
  return found[0].place;
}
