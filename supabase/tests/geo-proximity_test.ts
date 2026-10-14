// Nearest options (client request 14-oct-2026: "no tengo en Chimalhuacán pero
// tengo en la Roma, en Naucalpan… y los horarios son estos"):
//   * local gazetteer (mx-places.ts) and Haversine (geo.ts),
//   * optional geocoder with cache (Nominatim, stubbed here — no network),
//   * next free slots of an office (day-slots.ts → nextAvailableSlots),
//   * search_care_options: exact zone first, nearest across cities, nearest
//     city beyond the metro radius, never a hand-off while there are options,
//   * migration 20261014140000 replayed on PGlite.
//
//   npm run test:edge

import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleMcpRequest } from "../functions/findmed-mcp/server.ts";
import { TOOLS } from "../functions/findmed-mcp/tools.ts";
import { findMxPlace, MX_PLACES, normalizePlace } from "../functions/_shared/mx-places.ts";
import { geocodeMx, GEOCODER_USER_AGENT, haversineKm, roundKm, toPoint } from "../functions/_shared/geo.ts";
import { matchCatalogZones } from "../functions/_shared/care-search.ts";
import { nextAvailableSlots } from "../functions/_shared/day-slots.ts";
import { FakeDb } from "./fake-supabase.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_test" }));
Deno.env.set("APP_URL", "https://app.example.test");
// Never reach the real geocoder from tests (geocodeMx tests pass enabled + a fake fetch).
Deno.env.set("FINDMED_GEOCODER", "off");

const TOKEN = "test-mcp-token-0123456789";
const sb = (db: FakeDb) => db as unknown as SupabaseClient;

async function tool(db: FakeDb, name: string, args: Record<string, unknown>) {
  const res = await handleMcpRequest(
    new Request("https://x/functions/v1/findmed-mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
    { token: TOKEN, supabase: sb(db), tools: TOOLS, log: () => {} },
  );
  const body = await res.json();
  return JSON.parse(body.result.content[0].text);
}

// --- Gazetteer ---------------------------------------------------------------------

Deno.test("gazetteer: alcaldías, metro municipalities, colonias and cities are covered", () => {
  const count = (k: string) => MX_PLACES.filter((p) => p.kind === k).length;
  assertEquals(count("alcaldia"), 16);
  assert(count("municipio") >= 25, `municipios: ${count("municipio")}`);
  assert(count("colonia") >= 25, `colonias: ${count("colonia")}`);
  for (const c of ["Querétaro", "Guadalajara", "Toluca", "Aguascalientes", "Veracruz", "Guanajuato", "León", "Celaya", "Monterrey", "Puebla"]) {
    assert(MX_PLACES.some((p) => p.kind === "ciudad" && p.name === c), c);
  }
  // Every point is inside Mexico and no spelling points at two places.
  const owner = new Map<string, string>();
  for (const p of MX_PLACES) {
    assert(toPoint(p.lat, p.lon), p.name);
    for (const k of [p.name, ...(p.aliases ?? []), ...(p.exact ?? [])].map(normalizePlace)) {
      assert(!owner.has(k) || owner.get(k) === p.name, `"${k}" → ${owner.get(k)} y ${p.name}`);
      owner.set(k, p.name);
    }
  }
});

Deno.test("gazetteer: tolerant matching (accents, case, prefixes, aliases, qualifiers)", () => {
  const name = (q: string) => findMxPlace(q)?.name ?? null;
  assertEquals(name("Chimalhuacán"), "Chimalhuacán");
  assertEquals(name("chimalhuacan"), "Chimalhuacán");
  assertEquals(name("municipio de Chimalhuacán, Edomex"), "Chimalhuacán");
  assertEquals(name("Neza"), "Nezahualcóyotl");
  assertEquals(name("Cd. Neza"), "Nezahualcóyotl");
  assertEquals(name("izcalli"), "Cuautitlán Izcalli");
  assertEquals(name("Col. Roma Norte"), "Roma");
  assertEquals(name("colonia del valle"), "Del Valle");
  assertEquals(name("Alcaldía Coyoacán"), "Coyoacán");
  assertEquals(name("Coyoacán centro"), "Coyoacán centro");
  assertEquals(name("Tlalpan CDMX"), "Tlalpan");
  assertEquals(name("vivo en Ecatepec"), "Ecatepec");
  assertEquals(name("Satélite, Naucalpan"), "Ciudad Satélite"); // most specific wins
  assertEquals(name("Valle de Chalco"), "Valle de Chalco"); // not "Chalco"
  assertEquals(name("CDMX"), "Ciudad de México");
  assertEquals(name("df"), "Ciudad de México");
  assertEquals(name("Lomas"), "Lomas de Chapultepec");
  assertEquals(name("Interlomas"), "Interlomas");
  // Generic words never match inside other names.
  assertEquals(name("Lomas Estrella"), null);
  assertEquals(name("Ciudad Juárez"), null);
  assertEquals(name("busco doctores"), null);
  assertEquals(name("Tijuana"), null);
  assertEquals(name(""), null);
});

Deno.test("haversine: known distances (±10%) and rounding for people", () => {
  const cdmx = { lat: 19.4326, lon: -99.1332 };
  const qro = { lat: 20.5888, lon: -100.3899 };
  const km = haversineKm(cdmx, qro);
  assert(km > 170 && km < 205, String(km));
  const chimal = findMxPlace("Chimalhuacán")!;
  const roma = findMxPlace("Roma")!;
  const d = haversineKm(chimal, roma);
  assert(d > 18 && d < 25, String(d));
  assertEquals(roundKm(0.2), 1);
  assertEquals(roundKm(12.6), 13);
  assertEquals(toPoint(99, -99), null); // swapped/out of Mexico
  assertEquals(toPoint("19.4", "-99.1"), { lat: 19.4, lon: -99.1 });
  assertEquals(toPoint(null, -99), null);
});

Deno.test("catalog zones from free text: exact, specific names inside text, never directions", () => {
  const zones = [
    { id: "a", name: "Roma" },
    { id: "b", name: "Sur" },
    { id: "c", name: "Observatorio (poniente)" },
    { id: "d", name: "Naucalpan" },
    { id: "e", name: "Centro Poniente" },
  ];
  assertEquals(matchCatalogZones("roma", zones).map((z) => z.id), ["a"]);
  assertEquals(matchCatalogZones("Col. Roma", zones).map((z) => z.id), ["a"]);
  assertEquals(matchCatalogZones("Observatorio", zones).map((z) => z.id), ["c"]);
  assertEquals(matchCatalogZones("Naucalpan de Juárez", zones).map((z) => z.id), ["d"]);
  assertEquals(matchCatalogZones("Coyoacán sur", zones), []); // "Sur" is a direction, not a place
  assertEquals(matchCatalogZones("centro", zones), []);
  assertEquals(matchCatalogZones("Sur", zones).map((z) => z.id), ["b"]); // exact still works
});

// --- Geocoder -----------------------------------------------------------------------

function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; headers: Headers }[] = [];
  const f = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return Promise.resolve(respond(url));
  }) as typeof fetch;
  return { f, calls };
}

Deno.test("geocoder: Mexico only, own User-Agent, cached (also 'not found'); failures are not cached", async () => {
  const db = new FakeDb({ geo_cache: [] });
  const ok = fakeFetch(() => new Response(JSON.stringify([{ lat: "19.3906", lon: "-99.0700", display_name: "Santa Martha Acatitla, Iztapalapa, CDMX" }])));
  const hit = await geocodeMx(sb(db), "Santa Martha Acatitla", { enabled: true, fetchImpl: ok.f });
  assertEquals(hit, { lat: 19.3906, lon: -99.07, label: "Santa Martha Acatitla" });
  assertEquals(ok.calls.length, 1);
  assert(ok.calls[0].url.includes("countrycodes=mx"));
  assertEquals(ok.calls[0].headers.get("User-Agent"), GEOCODER_USER_AGENT);
  // Second time: from geo_cache, no request.
  const again = await geocodeMx(sb(db), "santa martha acatitla", { enabled: true, fetchImpl: ok.f });
  assertEquals([again?.lat, ok.calls.length], [19.3906, 1]);

  // A point outside Mexico is ignored and cached as not found.
  const abroad = fakeFetch(() => new Response(JSON.stringify([{ lat: "40.4", lon: "-3.7", display_name: "Madrid" }])));
  assertEquals(await geocodeMx(sb(db), "Madrid centro", { enabled: true, fetchImpl: abroad.f }), null);
  assertEquals(db.rows("geo_cache").find((r) => r.query_key === "madrid centro")?.found, false);
  assertEquals(await geocodeMx(sb(db), "Madrid centro", { enabled: true, fetchImpl: abroad.f }), null);
  assertEquals(abroad.calls.length, 1); // negative cache

  // 5xx / network error: null, nothing cached, retried next time.
  const down = fakeFetch(() => new Response("{}", { status: 503 }));
  assertEquals(await geocodeMx(sb(db), "Colonia Inventada", { enabled: true, fetchImpl: down.f }), null);
  const boom = fakeFetch(() => Promise.reject(new Error("network")));
  assertEquals(await geocodeMx(sb(db), "Colonia Inventada", { enabled: true, fetchImpl: boom.f }), null);
  assert(!db.rows("geo_cache").some((r) => r.query === "Colonia Inventada"));

  // Disabled (FINDMED_GEOCODER=off) or too short: no request at all.
  const never = fakeFetch(() => new Response("[]"));
  assertEquals(await geocodeMx(sb(db), "Iztacalco centro", { fetchImpl: never.f }), null);
  assertEquals(await geocodeMx(sb(db), "x", { enabled: true, fetchImpl: never.f }), null);
  assertEquals(never.calls.length, 0);
});

// --- Next free slots ------------------------------------------------------------------

function slotDb(weekdays: number[]) {
  return new FakeDb({
    doctor_offices: [{
      id: "o1", doctor_id: "d1", appointment_duration_minutes: 60, is_active: true, is_deleted: false,
      google_calendar_connected: false, outlook_calendar_connected: false,
    }],
    doctor_weekly_availability: weekdays.map((weekday) => ({ office_id: "o1", weekday, is_enabled: true, start_time: "09:00:00", end_time: "11:00:00" })),
    doctor_date_overrides: [],
    appointments: [],
  });
}

Deno.test("nextAvailableSlots: first free slots over the next days; empty range vs. out of time", async () => {
  // 2027-03-01 is a Monday; the office only works Wednesdays (3), 09–11, 60-min slots.
  const r = await nextAvailableSlots(sb(slotDb([3])), "o1", { fromDate: "2027-03-01", days: 7, max: 3 });
  assertEquals(r.slots.map((s) => `${s.date} ${s.time}`), ["2027-03-03 09:00", "2027-03-03 10:00"]);
  assertEquals([r.status, r.days_checked], ["verified", 7]);
  const two = await nextAvailableSlots(sb(slotDb([1, 3])), "o1", { fromDate: "2027-03-01", max: 3 });
  assertEquals([two.slots.map((s) => `${s.date} ${s.time}`), two.days_checked], [["2027-03-01 09:00", "2027-03-01 10:00", "2027-03-03 09:00"], 3]);
  const none = await nextAvailableSlots(sb(slotDb([])), "o1", { fromDate: "2027-03-01", days: 7 });
  assertEquals([none.slots.length, none.status, none.days_checked], [0, "none_in_range", 7]);
  const late = await nextAvailableSlots(sb(slotDb([3])), "o1", { fromDate: "2027-03-01", deadlineMs: Date.now() - 1 });
  assertEquals([late.slots.length, late.status], [0, "not_checked"]);
  const gone = await nextAvailableSlots(sb(slotDb([3])), "missing", { fromDate: "2027-03-01" });
  assertEquals(gone.status, "not_checked");
});

// --- search_care_options: nearest options ----------------------------------------------

const CDMX = "c-cdmx";
const EDOMEX = "c-edomex";
const QRO = "c-qro";
const DOC = (n: number) => `dddddddd-0000-4000-8000-00000000000${n}`;
const OFF = (n: number) => `0ffece00-0000-4000-8000-00000000000${n}`;

function geoDb() {
  const office = (n: number, city: string, zone: string | null, workdays = [0, 1, 2, 3, 4, 5, 6]) => ({
    office: {
      id: OFF(n), doctor_id: DOC(n), name: `Consultorio ${n}`, address: `Calle ${n}`, city_id: city, zone_id: zone,
      is_active: true, is_deleted: false, appointment_duration_minutes: 60,
      google_calendar_connected: false, outlook_calendar_connected: false,
      "doctors.is_active": true, "doctors.is_deleted": false,
      doctors: { id: DOC(n), full_name: `Dr. Ortopedista ${n}`, phone: null },
    },
    hours: workdays.map((weekday) => ({ office_id: OFF(n), weekday, is_enabled: true, start_time: "09:00:00", end_time: "12:00:00" })),
  });
  const offices = [
    office(1, CDMX, "z-roma"), // zone with coordinates
    office(2, EDOMEX, "z-nau"), // zone with coordinates, another catalog city
    office(3, CDMX, "z-sur", []), // directional zone without coordinates → city point; no hours
    office(4, QRO, null), // ~190 km away
  ];
  return new FakeDb({
    cities: [
      { id: CDMX, name: "Ciudad de México", latitude: 19.4326, longitude: -99.1332 },
      { id: EDOMEX, name: "Estado de México", latitude: null, longitude: null },
      { id: QRO, name: "Querétaro", latitude: "20.588800", longitude: "-100.389900" },
    ],
    zones: [
      { id: "z-roma", name: "Roma", city_id: CDMX, latitude: 19.417, longitude: -99.16 },
      { id: "z-nau", name: "Naucalpan", city_id: EDOMEX, latitude: 19.478, longitude: -99.239 },
      { id: "z-sur", name: "Sur", city_id: CDMX, latitude: null, longitude: null },
    ],
    doctor_specialties: offices.map((o) => ({ doctor_id: o.office.doctor_id, "specialties.name": "Ortopedia", specialties: { name: "Ortopedia" } })),
    doctor_offices: offices.map((o) => o.office),
    doctor_weekly_availability: offices.flatMap((o) => o.hours),
    doctor_date_overrides: [],
    appointments: [],
    geo_cache: [],
  });
}

type Opt = {
  office_id: string; zone: string | null; city: string | null; distance_km: number | null; distance_basis: string | null;
  in_requested_zone: boolean | null; next_slots: { date: string; time: string; label: string; por_confirmar: boolean }[]; slots_status: string;
};

Deno.test("search_care_options: Chimalhuacán has no office → nearest bookable options with distance and slots, no hand-off", async () => {
  const e = await tool(geoDb(), "search_care_options", { specialty: "ortopedista", city: "Estado de México", zone: "Chimalhuacán" });
  assertEquals([e.ok, e.status, e.data.result, e.data.nearest, e.data.requested_location_has_options], [true, "success", "many", true, false]);
  assertEquals(e.data.requested_location, "Chimalhuacán");
  assertEquals([e.data.escalate, e.data.alternatives, e.data.max_distance_km], [false, null, 60]);
  assert(String(e.data.note).startsWith("No hay consultorio de Ortopedia en Chimalhuacán; estas son las opciones más cercanas"));
  const opts = e.data.options as Opt[];
  // Precise points first (Roma ~22 km, Naucalpan ~31 km), then the office only placed by its city; Querétaro is too far.
  assertEquals(opts.map((o) => o.office_id), [OFF(1), OFF(2), OFF(3)]);
  assertEquals(opts.map((o) => o.distance_basis), ["zone", "zone", "city"]);
  assert(opts[0].distance_km! >= 18 && opts[0].distance_km! <= 25, String(opts[0].distance_km));
  assert(opts[1].distance_km! > opts[0].distance_km!);
  assertEquals(opts.map((o) => o.in_requested_zone), [false, false, false]);
  // Next slots: up to 3 per option, with a ready label; none for the office without hours.
  assertEquals(opts[0].next_slots.length, 3);
  assertEquals(opts[0].slots_status, "verified");
  assert(/^(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d+ de \w+, \d\d:\d\d$/.test(opts[0].next_slots[0].label), opts[0].next_slots[0].label);
  assertEquals(opts[0].next_slots[0].por_confirmar, false);
  assertEquals([opts[2].next_slots.length, opts[2].slots_status], [0, "none_in_range"]);
  assert(!JSON.stringify(e).match(/no (tenemos|hay) (médicos|especialistas)/i));
});

Deno.test("search_care_options: a municipality said as the city ('Neza') is placed too", async () => {
  const e = await tool(geoDb(), "search_care_options", { specialty: "Ortopedia", city: "Neza" });
  assertEquals([e.status, e.data.result, e.data.nearest, e.data.requested_location], ["success", "many", true, "Nezahualcóyotl"]);
  assertEquals((e.data.options as Opt[])[0].office_id, OFF(1));
});

Deno.test("search_care_options: exact zone first, then the nearest others up to 3", async () => {
  const e = await tool(geoDb(), "search_care_options", { specialty: "Ortopedia", city: "CDMX", zone: "Col. Roma" });
  assertEquals([e.data.result, e.data.nearest, e.data.requested_location_has_options], ["many", false, true]);
  const opts = e.data.options as Opt[];
  assertEquals(opts.map((o) => o.office_id), [OFF(1), OFF(2), OFF(3)]);
  assertEquals(opts.map((o) => o.in_requested_zone), [true, false, false]);
  assertEquals(opts[0].distance_km, 1);
  assertEquals(opts[0].next_slots.length, 3);
  assertEquals(e.data.note, null);
});

Deno.test("search_care_options: a zone of the catalog assigned to another city still counts as the requested place", async () => {
  // Naucalpan lives under "Estado de México"; the patient says CDMX.
  const e = await tool(geoDb(), "search_care_options", { specialty: "Ortopedia", city: "CDMX", zone: "Naucalpan" });
  assertEquals([e.data.result, e.data.nearest, e.data.requested_location_has_options], ["many", false, true]);
  assertEquals((e.data.options as Opt[])[0].office_id, OFF(2));
  assertEquals((e.data.options as Opt[])[0].in_requested_zone, true);
});

Deno.test("search_care_options: nothing within 60 km → nearest city with distance, asked (not escalated)", async () => {
  const e = await tool(geoDb(), "search_care_options", { specialty: "Ortopedia", city: "Puebla" });
  assertEquals([e.status, e.data.result, e.data.escalate], ["needs_more_info", "none", false]);
  assertEquals(e.data.alternatives.scope, "other_cities");
  assertEquals(e.data.alternatives.cities[0].city, "Ciudad de México");
  assert(e.data.alternatives.cities[0].distance_km > 60);
  assert(String(e.nextQuestion).includes("La opción más cercana está en Ciudad de México (a unos"));
  assert(String(e.nextQuestion).includes("persona de FindMed"));
});

Deno.test("search_care_options: a place that can't be located → a question, never an escalation", async () => {
  // Querétaro has offices but no zones; "Juriquilla" is not in the gazetteer and the geocoder is off.
  const e = await tool(geoDb(), "search_care_options", { specialty: "Ortopedia", city: "Querétaro", zone: "Juriquilla" });
  assertEquals([e.status, e.data.escalate], ["needs_more_info", false]);
  assertEquals(e.data.alternatives.scope, "other_zones");
  const unknown = await tool(geoDb(), "search_care_options", { specialty: "Ortopedia", city: "Tijuana" });
  assertEquals([unknown.status, unknown.data.reason, unknown.data.escalate], ["needs_more_info", "unknown_city", false]);
  assert(String(unknown.nextQuestion).includes("colonia o municipio"));
});

// --- Migration --------------------------------------------------------------------------

Deno.test("migration 20261014140000: coordinates columns, production seed, constraints, geo_cache with RLS", async () => {
  const sql = await Deno.readTextFile(new URL("../migrations/20261014140000_geo_proximity.sql", import.meta.url));
  const db = await PGlite.create();
  const zones = [
    ["Ciudad de México", "Centro Poniente"], ["Ciudad de México", "Condesa"], ["Ciudad de México", "Cuauhtemoc"],
    ["Ciudad de México", "Escandón"], ["Ciudad de México", "Huixquilucan"], ["Ciudad de México", "Lomas"],
    ["Ciudad de México", "Norte"], ["Ciudad de México", "Observatorio (poniente)"], ["Ciudad de México", "Pedregal"],
    ["Ciudad de México", "Poniente"], ["Ciudad de México", "Roma"], ["Ciudad de México", "Satélite"],
    ["Ciudad de México", "Sur"], ["Estado de México", "Ecatepec"], ["Estado de México", "Naucalpan"],
    ["Estado de México", "Tecamac"], ["Estado de México", "Tlalnepantla"],
  ];
  const cities = ["Aguascalientes", "Celaya", "Ciudad de México", "Estado de México", "Guadalajara", "Guanajuato", "Querétaro", "Toluca", "Veracruz"];
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE TABLE public.cities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE public.zones (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), city_id uuid REFERENCES public.cities(id), name text NOT NULL, is_active boolean NOT NULL DEFAULT true);
    INSERT INTO public.cities (name) VALUES ${cities.map((c) => `('${c}')`).join(", ")};
    INSERT INTO public.zones (city_id, name) VALUES ${zones.map(([c, z]) => `((SELECT id FROM public.cities WHERE name = '${c}'), '${z}')`).join(", ")};
  `);
  await db.exec(sql);

  const nullZones = await db.query<{ name: string }>("SELECT name FROM zones WHERE latitude IS NULL ORDER BY name");
  assertEquals(nullZones.rows.map((r) => r.name), ["Centro Poniente", "Norte", "Poniente", "Sur"]);
  const nullCities = await db.query<{ name: string }>("SELECT name FROM cities WHERE latitude IS NULL");
  assertEquals(nullCities.rows.map((r) => r.name), ["Estado de México"]);
  const roma = await db.query<{ lat: string; lon: string }>("SELECT latitude::text AS lat, longitude::text AS lon FROM zones WHERE name = 'Roma'");
  assertEquals([roma.rows[0].lat, roma.rows[0].lon], ["19.417000", "-99.160000"]);

  // Seed never overwrites what the admin set.
  await db.exec("UPDATE zones SET latitude = 19.5, longitude = -99.2 WHERE name = 'Roma'");
  // Re-run (minus the constraints, which can only be added once).
  await db.exec(sql.replace(/ALTER TABLE public\.(zones|cities)\s+ADD CONSTRAINT[\s\S]*?\);\r?\n/g, ""));
  const kept = await db.query<{ lat: string }>("SELECT latitude::text AS lat FROM zones WHERE name = 'Roma'");
  assertEquals(kept.rows[0].lat, "19.500000");

  const rejects = async (q: string) => {
    try {
      await db.exec(q);
      return false;
    } catch {
      return true;
    }
  };
  assert(await rejects("UPDATE zones SET latitude = 19.4 WHERE name = 'Norte'")); // lat without lon
  assert(await rejects("UPDATE zones SET latitude = -99.1, longitude = 19.4 WHERE name = 'Norte'")); // swapped
  assert(await rejects("UPDATE cities SET latitude = 40.4, longitude = -3.7 WHERE name = 'Celaya'")); // outside Mexico
  assert(!(await rejects("UPDATE zones SET latitude = 19.49, longitude = -99.13 WHERE name = 'Norte'")));

  assert(await rejects("INSERT INTO geo_cache (query_key, query, found) VALUES ('x', 'x', true)")); // found needs a point
  assert(!(await rejects("INSERT INTO geo_cache (query_key, query, found) VALUES ('y', 'y', false)")));
  const rls = await db.query<{ r: boolean }>("SELECT relrowsecurity AS r FROM pg_class WHERE relname = 'geo_cache'");
  assertEquals(rls.rows[0].r, true);
  const policies = await db.query<{ cmd: string }>("SELECT cmd FROM pg_policies WHERE tablename = 'geo_cache'");
  assertEquals(policies.rows.map((p) => p.cmd), ["SELECT"]);
  await db.close();
});
