// FindMed decisions a/b/c (14-oct-2026) and the "never say there are no
// doctors in your zone" fix:
//   * insurance on the patient (save_patient_insurance, create_booking_link,
//     admin-update-patient-insurance),
//   * network hospitals/laboratories by city (find_network_*),
//   * search_care_options alternatives instead of a dead-end "none",
//   * "documentos recibidos" from WhatsApp media,
//   * the migration (columns, constraint, trigger, enum) replayed on PGlite.
//
//   npm run test:edge

import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleMcpRequest } from "../functions/findmed-mcp/server.ts";
import { TOOLS } from "../functions/findmed-mcp/tools.ts";
import { cleanPolicyNumber, insurancePatch } from "../functions/_shared/patient-insurance.ts";
import { carryOverDocuments, markDocumentsReceived, parseInboundMedia } from "../functions/_shared/patient-documents.ts";
import { processWhaapyEvent } from "../functions/_shared/whaapy-events.ts";
import type { WhaapyClient } from "../functions/_shared/whaapy-client.ts";
import { handlePatientInsurance } from "../functions/admin-update-patient-insurance/handler.ts";
import { FakeDb } from "./fake-supabase.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_test" }));
Deno.env.set("APP_URL", "https://app.example.test");
// search_care_options may try the geocoder for unknown places: never from tests.
Deno.env.set("FINDMED_GEOCODER", "off");

const TOKEN = "test-mcp-token-0123456789";
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
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
  if (body.error) return { rpcError: body.error, envelope: null as never };
  return { rpcError: null, envelope: JSON.parse(body.result.content[0].text) };
}

// --- Catalog shared by the location tests ----------------------------------------

const CDMX = "c-cdmx";
const EDOMEX = "c-edomex";
const QRO = "c-qro";
const CELAYA = "c-celaya";

function catalog(extra: Record<string, Record<string, unknown>[]> = {}) {
  return new FakeDb({
    cities: [
      { id: CDMX, name: "Ciudad de México" },
      { id: EDOMEX, name: "Estado de México" },
      { id: QRO, name: "Querétaro" },
      { id: CELAYA, name: "Celaya" },
    ],
    zones: [
      { id: "z-sur", name: "Sur", city_id: CDMX },
      { id: "z-lomas", name: "Lomas", city_id: CDMX },
      { id: "z-roma", name: "Roma", city_id: CDMX },
      { id: "z-nau", name: "Naucalpan", city_id: EDOMEX },
    ],
    hospitals: [
      { id: "h1", name: "Hospital Ángeles Pedregal", address: "Camino a Santa Teresa 1055", phone: null, city_id: CDMX, zone_id: "z-sur", is_active: true },
      { id: "h2", name: "Hospital ABC Observatorio", address: "Sur 136 116", phone: "5552308000", city_id: CDMX, zone_id: "z-lomas", is_active: true },
      { id: "h3", name: "Hospital Español", address: "Ejército Nacional 613", phone: "", city_id: CDMX, zone_id: null, is_active: true },
      { id: "h4", name: "Hospital Inactivo", address: "X", phone: null, city_id: CDMX, zone_id: "z-sur", is_active: false },
      { id: "h5", name: "Hospital Satélite", address: "Circuito 1", phone: null, city_id: EDOMEX, zone_id: "z-nau", is_active: true },
      { id: "h6", name: "Hospital Querétaro", address: "Bernardo Quintana", phone: null, city_id: QRO, zone_id: null, is_active: true },
    ],
    laboratories: [
      { id: "l1", name: "Laboratorio Sur", address: "Av. Sur 1", phone: "5511112222", city_id: CDMX, zone_id: "z-sur", is_active: true },
    ],
    ...extra,
  });
}

// --- Insurance -----------------------------------------------------------------

Deno.test("insurance: merge keeps what the patient didn't repeat; another insurer drops the old policy; 'no' clears", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const current = { has_insurance: true, insurer: "GNP", policy_number: "ABC123" };
  assertEquals(insurancePatch(current, { hasInsurance: true }, "merge", now), { ...current, insurance_updated_at: now.toISOString() });
  assertEquals(insurancePatch(current, { hasInsurance: true, insurer: "gnp" }, "merge", now).policy_number, "ABC123");
  const other = insurancePatch(current, { hasInsurance: true, insurer: "AXA" }, "merge", now);
  assertEquals([other.insurer, other.policy_number], ["AXA", null]);
  const none = insurancePatch(current, { hasInsurance: false, insurer: "AXA", policyNumber: "1" }, "merge", now);
  assertEquals([none.has_insurance, none.insurer, none.policy_number], [false, null, null]);
  // Admin "replace": blank means blank.
  const replaced = insurancePatch(current, { hasInsurance: true, insurer: "  Seguros   Monterrey ", policyNumber: "" }, "replace", now);
  assertEquals([replaced.insurer, replaced.policy_number], ["Seguros Monterrey", null]);
  assertEquals(insurancePatch(current, { hasInsurance: null }, "replace", now).has_insurance, null);
  assertEquals(cleanPolicyNumber(" 12 345-A/7 "), "12345-A/7");
});

Deno.test("save_patient_insurance: updates the contact's patient, never creates a nameless one", async () => {
  const db = new FakeDb({ patients: [{ id: "p1", full_name: "Ana", phone: "+525512345678", created_at: iso(1) }] });

  const ok = await tool(db, "save_patient_insurance", { phone: "5215512345678", has_insurance: true, insurer: "GNP", policy_number: "POL-77" });
  assertEquals(ok.envelope.ok, true);
  assertEquals(ok.envelope.data.saved, true);
  assertEquals(ok.envelope.data.policy_number_saved, true);
  const p = db.rows("patients")[0];
  assertEquals([p.has_insurance, p.insurer, p.policy_number], [true, "GNP", "POL-77"]);
  assert(p.insurance_updated_at);

  // Unknown number and no name → nothing created, the agent is told how to continue.
  const ghost = await tool(db, "save_patient_insurance", { phone: "5599990000", has_insurance: true, insurer: "AXA" });
  assertEquals([ghost.envelope.ok, ghost.envelope.data.saved, ghost.envelope.data.reason], [true, false, "patient_not_registered"]);
  assertEquals(db.rows("patients").length, 1);

  // With the name it follows create_booking_link's pattern: canonical phone + name.
  const created = await tool(db, "save_patient_insurance", { phone: "+52 1 55 9999 0000", has_insurance: false, patient_name: "Luis Pérez" });
  assertEquals([created.envelope.data.saved, created.envelope.data.created_patient], [true, true]);
  const luis = db.rows("patients").find((r) => r.full_name === "Luis Pérez")!;
  assertEquals([luis.phone, luis.has_insurance, luis.insurer], ["+525599990000", false, null]);

  const bad = await tool(db, "save_patient_insurance", { phone: "123", has_insurance: true });
  assertEquals(bad.rpcError?.data?.field, "phone"); // schema rejects it before the handler
  const invalid = await tool(db, "save_patient_insurance", { phone: "+52 55 12", has_insurance: true });
  assertEquals(invalid.envelope.errors[0].code, "invalid_phone");
  const extra = await tool(db, "save_patient_insurance", { phone: "5512345678", has_insurance: true, rfc: "X" });
  assertEquals(extra.rpcError?.data?.reason, "unexpected property");
});

Deno.test("create_booking_link: optional insurance is saved on the patient; the link never depends on it", async () => {
  const db = new FakeDb({
    doctors: [{ id: "dddddddd-0000-0000-0000-000000000001", full_name: "Dra. Prueba", is_active: true, is_deleted: false }],
    doctor_offices: [{ id: "11111111-1111-1111-1111-111111111111", doctor_id: "dddddddd-0000-0000-0000-000000000001", name: "Polanco", address: "Calle 1", is_active: true, is_deleted: false }],
    patients: [],
    reservation_sessions: [],
  });
  const base = { phone: "5512345678", patient_name: "Ana López", doctor_id: "dddddddd-0000-0000-0000-000000000001", office_id: "11111111-1111-1111-1111-111111111111" };
  const r = await tool(db, "create_booking_link", { ...base, insurer: "MetLife", policy_number: "M-1" });
  assertEquals(r.envelope.ok, true);
  assertEquals(r.envelope.data.insurance_saved, true);
  const p = db.rows("patients")[0];
  assertEquals([p.has_insurance, p.insurer, p.policy_number], [true, "MetLife", "M-1"]);

  const without = await tool(db, "create_booking_link", base);
  assertEquals(without.envelope.data.insurance_saved, null);
  assertEquals(db.rows("patients")[0].insurer, "MetLife"); // untouched
});

Deno.test("admin-update-patient-insurance: admin only, validated, replace semantics", async () => {
  const PID = "aaaaaaaa-0000-4000-8000-000000000001";
  const db = new FakeDb({ patients: [{ id: PID, full_name: "Ana", phone: "+525512345678", has_insurance: true, insurer: "GNP", policy_number: "P1" }] });
  const call = (body: unknown, ok = true) =>
    handlePatientInsurance(new Request("https://x", { method: "POST", body: JSON.stringify(body) }), {
      supabase: sb(db),
      authorize: () => Promise.resolve(ok ? { ok: true as const, userId: "u1" } : { ok: false as const, status: 403, error: "Forbidden" }),
    });

  assertEquals((await call({ patient_id: PID, has_insurance: false }, false)).status, 403);
  assertEquals(db.rows("patients")[0].insurer, "GNP");
  assertEquals((await call({ patient_id: "nope", has_insurance: true })).status, 400);
  assertEquals((await call({ patient_id: PID, has_insurance: "si" })).status, 400);
  assertEquals((await call({ patient_id: "aaaaaaaa-0000-4000-8000-000000000009", has_insurance: true })).status, 404);

  const res = await call({ patient_id: PID, has_insurance: true, insurer: "AXA", policy_number: "" });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).patient, { id: PID, has_insurance: true, insurer: "AXA", policy_number: null });
  await call({ patient_id: PID, has_insurance: null });
  assertEquals(db.rows("patients")[0].has_insurance, null);
});

// --- Network hospitals / laboratories ---------------------------------------------

Deno.test("find_network_hospitals: CDMX alias, zone first, phone only when the catalog has it", async () => {
  const { envelope } = await tool(catalog(), "find_network_hospitals", { city: "CDMX", zone: "Lomas" });
  assertEquals(envelope.ok, true);
  assertEquals(envelope.data.result, "many");
  const hs = envelope.data.hospitals as { name: string; phone: string | null; zone: string | null; in_requested_zone: boolean }[];
  assertEquals(hs.length, 3); // default limit; the inactive one never appears
  assertEquals(hs[0].name, "Hospital ABC Observatorio");
  assertEquals([hs[0].phone, hs[0].in_requested_zone], ["5552308000", true]);
  assertEquals(hs.find((h) => h.name === "Hospital Español")!.phone, null); // "" in the catalog → null, never invented
  assert(!hs.some((h) => h.name === "Hospital Inactivo"));
});

Deno.test("find_network_hospitals: a zone name works as the location (Naucalpan → Estado de México)", async () => {
  const { envelope } = await tool(catalog(), "find_network_hospitals", { city: "naucalpan", limit: 1 });
  assertEquals([envelope.data.result, envelope.data.city, envelope.data.zone], ["one", "Estado de México", "Naucalpan"]);
  assertEquals(envelope.data.hospitals[0].name, "Hospital Satélite");
  const edomex = await tool(catalog(), "find_network_hospitals", { city: "Edomex" });
  assertEquals(edomex.envelope.data.city, "Estado de México");
});

Deno.test("find_network_hospitals: unknown/ambiguous asks; a city without network lists others and escalates", async () => {
  const unknown = await tool(catalog(), "find_network_hospitals", { city: "Tijuana" });
  assertEquals([unknown.envelope.status, unknown.envelope.data.reason], ["needs_more_info", "unknown_city"]);
  assert(unknown.envelope.nextQuestion);

  const ambiguous = await tool(catalog(), "find_network_hospitals", { city: "México" });
  assertEquals(ambiguous.envelope.data.reason, "ambiguous_city");
  assertEquals(ambiguous.envelope.data.city_candidates.sort(), ["Ciudad de México", "Estado de México"]);

  const celaya = await tool(catalog(), "find_network_hospitals", { city: "Celaya" });
  assertEquals([celaya.envelope.data.result, celaya.envelope.data.reason, celaya.envelope.data.escalate], ["none", "none_in_city", true]);
  assertEquals(celaya.envelope.data.hospitals, []);
  assertEquals(celaya.envelope.data.other_cities[0], { city: "Ciudad de México", count: 3 });
});

Deno.test("find_network_laboratories: same shape over the laboratories catalog", async () => {
  const { envelope } = await tool(catalog(), "find_network_laboratories", { city: "Ciudad de Mexico" });
  assertEquals([envelope.data.result, envelope.data.laboratories[0].name], ["one", "Laboratorio Sur"]);
  const qro = await tool(catalog(), "find_network_laboratories", { city: "qro" });
  assertEquals([qro.envelope.data.reason, qro.envelope.data.other_cities], ["none_in_city", [{ city: "Ciudad de México", count: 1 }]]);
});

// --- search_care_options: alternatives instead of "no hay médicos en tu zona" ------

// FakeDb ignores embeds, so the rows carry the flattened keys the filters use.
function careDb(offices: { id: string; doctor: string; city: string; zone: string | null }[]) {
  const doctors = [...new Set(offices.map((o) => o.doctor))];
  return catalog({
    doctor_specialties: doctors.map((d) => ({ doctor_id: d, "specialties.name": "Ortopedia", specialties: { name: "Ortopedia" } })),
    doctor_offices: offices.map((o) => ({
      id: o.id,
      doctor_id: o.doctor,
      name: `Consultorio ${o.id}`,
      address: "Calle 1",
      city_id: o.city,
      zone_id: o.zone,
      is_active: true,
      is_deleted: false,
      "doctors.is_active": true,
      "doctors.is_deleted": false,
      doctors: { id: o.doctor, full_name: `Dr. ${o.doctor}`, phone: null },
    })),
  });
}

Deno.test("search_care_options: no office in the zone → options in other zones of the same city", async () => {
  const db = careDb([
    { id: "o1", doctor: "d1", city: CDMX, zone: "z-sur" },
    { id: "o2", doctor: "d2", city: CDMX, zone: "z-lomas" },
  ]);
  const { envelope } = await tool(db, "search_care_options", { specialty: "ortopedista", city: "CDMX", zone: "Roma" });
  assertEquals([envelope.ok, envelope.status, envelope.data.result], [true, "needs_more_info", "none"]);
  assertEquals(envelope.data.alternatives.scope, "other_zones");
  assertEquals(envelope.data.alternatives.zones, ["Lomas", "Sur"]);
  assertEquals(envelope.data.alternatives.options.length, 2);
  assert(String(envelope.nextQuestion).includes("Lomas, Sur"));
  assert(!/no (tenemos|hay)/i.test(envelope.nextQuestion));

  // A colonia that isn't in the catalog: same thing, no dead end.
  const colonia = await tool(db, "search_care_options", { specialty: "ortopedia", city: "CDMX", zone: "Coyoacán" });
  assertEquals([colonia.envelope.data.reason, colonia.envelope.data.alternatives.scope], ["unknown_zone", "other_zones"]);
});

Deno.test("search_care_options: nothing in the city → other cities; nothing anywhere → escalate", async () => {
  const db = careDb([{ id: "o1", doctor: "d1", city: QRO, zone: null }]);
  const r = await tool(db, "search_care_options", { specialty: "Ortopedia", city: "CDMX" });
  assertEquals([r.envelope.data.reason, r.envelope.data.alternatives.scope], ["no_active_offices", "other_cities"]);
  assertEquals(r.envelope.data.alternatives.cities, [{ city: "Querétaro", options: 1 }]);
  assert(String(r.envelope.nextQuestion).includes("persona de FindMed"));

  const lonely = careDb([{ id: "o1", doctor: "d1", city: CDMX, zone: "z-sur" }]);
  lonely.rows("doctor_offices")[0].is_active = false;
  const e = await tool(lonely, "search_care_options", { specialty: "Ortopedia", city: "CDMX" });
  assertEquals([e.envelope.status, e.envelope.data.escalate, e.envelope.data.alternatives], ["success", true, null]);

  const unknownCity = await tool(db, "search_care_options", { specialty: "Ortopedia", city: "Tijuana" });
  assertEquals(unknownCity.envelope.data.available_cities, ["Querétaro"]);
  assert(String(unknownCity.envelope.nextQuestion).includes("Querétaro"));
});

// --- Documents received ---------------------------------------------------------

const APPT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PAST = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

function docsDb(requested: "marker" | "delivery" | "no") {
  const now = Date.now();
  return new FakeDb({
    patients: [{ id: "p1", full_name: "Ana López", phone: "+525512345678" }],
    appointments: [
      {
        id: APPT, patient_id: "p1", doctor_id: "d1", status: "scheduled", start_at: iso(now + 30 * H),
        documents_requested_at: requested === "marker" ? iso(now - H) : null, documents_received_at: null,
      },
      { id: PAST, patient_id: "p1", doctor_id: "d1", status: "confirmed", start_at: iso(now - 30 * H), documents_requested_at: iso(now - 40 * H), documents_received_at: null },
    ],
    message_deliveries: requested === "delivery"
      ? [{ id: "md1", appointment_id: APPT, template_name: "pedir_documentos", status: "delivered", created_at: iso(now - 2 * H) }]
      : [],
    notifications: [],
  });
}

const media = (type: string, from = "5215512345678") => ({ message: { from, id: "wamid.1", type, [type]: { id: "media-1", mime_type: "image/jpeg" } } });

Deno.test("documents: only images and PDFs from the patient count", () => {
  assertEquals(parseInboundMedia(media("image")), { phone: "5215512345678", type: "image", wamid: "wamid.1" });
  assertEquals(parseInboundMedia(media("document"))?.type, "document");
  assertEquals(parseInboundMedia(media("audio")), null);
  assertEquals(parseInboundMedia({ message: { from: "52155", type: "text", text: { body: "hola" } } }), null);
});

Deno.test("documents: marks the upcoming requested appointment once and notifies admins once", async () => {
  const db = docsDb("marker");
  const first = await markDocumentsReceived(sb(db), "5215512345678");
  assertEquals(first, { outcome: "documents_received", appointment_ids: [APPT] });
  const appt = db.rows("appointments").find((a) => a.id === APPT)!;
  assert(appt.documents_received_at);
  assertEquals(db.rows("appointments").find((a) => a.id === PAST)!.documents_received_at, null); // past: untouched
  const n = db.rows("notifications");
  assertEquals(n.length, 1);
  assertEquals([n[0].recipient_role, n[0].type, n[0].appointment_id, n[0].title], ["admin", "documents_received", APPT, "Documentos recibidos de Ana López"]);
  assert(!JSON.stringify(n[0]).includes("media-1")); // nothing about the file is stored

  // The INE after the policy (or a webhook retry): no second mark, no second notification.
  const second = await markDocumentsReceived(sb(db), "+52 55 1234 5678");
  assertEquals(second.outcome, "media_documents_already_received");
  assertEquals(db.rows("notifications").length, 1);
});

Deno.test("documents: request detected from the pedir_documentos delivery when the marker is missing", async () => {
  const db = docsDb("delivery");
  const r = await markDocumentsReceived(sb(db), "5512345678");
  assertEquals(r.outcome, "documents_received");
  const appt = db.rows("appointments").find((a) => a.id === APPT)!;
  assert(appt.documents_requested_at && appt.documents_received_at);
});

Deno.test("documents: nothing happens without a request, an appointment or a patient", async () => {
  const notAsked = docsDb("no");
  assertEquals((await markDocumentsReceived(sb(notAsked), "5512345678")).outcome, "media_documents_not_requested");
  assertEquals(notAsked.rows("notifications").length, 0);
  assertEquals((await markDocumentsReceived(sb(docsDb("marker")), "5599990000")).outcome, "media_no_patient");
  const noUpcoming = docsDb("marker");
  noUpcoming.rows("appointments").find((a) => a.id === APPT)!.status = "cancelled";
  assertEquals((await markDocumentsReceived(sb(noUpcoming), "5512345678")).outcome, "media_no_upcoming_appointment");
  assertEquals((await markDocumentsReceived(sb(docsDb("marker")), "abc")).outcome, "media_invalid_phone");
});

Deno.test("documents: a patient reschedule (new appointment) keeps the documents state of the original", async () => {
  const NEW = "cccccccc-3333-4333-8333-cccccccccccc";
  const db = docsDb("marker");
  await markDocumentsReceived(sb(db), "5512345678"); // original: requested + received
  const original = db.rows("appointments").find((a) => a.id === APPT)!;
  original.status = "cancelled"; // manage-reschedule cancels it after inserting the new one
  db.rows("appointments").push({ id: NEW, patient_id: "p1", doctor_id: "d1", status: "scheduled", start_at: iso(Date.now() + 60 * H), documents_requested_at: null, documents_received_at: null });

  await carryOverDocuments(sb(db), APPT, NEW);
  const moved = db.rows("appointments").find((a) => a.id === NEW)!;
  assertEquals([moved.documents_requested_at, moved.documents_received_at], [original.documents_requested_at, original.documents_received_at]);
  // Not "pending" again, and a later photo doesn't notify twice.
  assertEquals((await markDocumentsReceived(sb(db), "5512345678")).outcome, "media_documents_already_received");
  assertEquals(db.rows("notifications").length, 1);

  // Requested but not received yet → the new appointment is still pending and gets marked on the next photo.
  const pending = docsDb("marker");
  pending.rows("appointments").find((a) => a.id === APPT)!.status = "cancelled";
  pending.rows("appointments").push({ id: NEW, patient_id: "p1", doctor_id: "d1", status: "scheduled", start_at: iso(Date.now() + 60 * H), documents_requested_at: null, documents_received_at: null });
  await carryOverDocuments(sb(pending), APPT, NEW);
  assertEquals(await markDocumentsReceived(sb(pending), "5512345678"), { outcome: "documents_received", appointment_ids: [NEW] });

  // Nothing to carry: the new row stays untouched.
  const none = docsDb("no");
  none.rows("appointments").push({ id: NEW, patient_id: "p1", doctor_id: "d1", status: "scheduled", start_at: iso(Date.now() + 60 * H), documents_requested_at: null, documents_received_at: null });
  await carryOverDocuments(sb(none), APPT, NEW);
  assertEquals(none.rows("appointments").find((a) => a.id === NEW)!.documents_requested_at, null);
});

Deno.test("documents: whaapy message.received with an image goes through processWhaapyEvent", async () => {
  const db = docsDb("marker");
  const whaapy = { configured: true, sendMessage: () => Promise.reject(new Error("must not reply")) } as unknown as WhaapyClient;
  const r = await processWhaapyEvent(sb(db), whaapy, { id: "e1", event_type: "message.received", payload: { data: media("image") } });
  assertEquals(r.outcome, "documents_received");
  const text = await processWhaapyEvent(sb(db), whaapy, { id: "e2", event_type: "message.received", payload: { data: { message: { from: "5215512345678", type: "text", text: { body: "hola" } } } } });
  assertEquals(text.outcome, "stored");
});

// --- Migration --------------------------------------------------------------------

Deno.test("migration 20261014130000: columns, 'sin seguro' constraint, requested trigger, enum value", async () => {
  const sql = await Deno.readTextFile(new URL("../migrations/20261014130000_patient_insurance_documents.sql", import.meta.url));
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE TYPE public.notification_type AS ENUM ('appointment_scheduled');
    CREATE TYPE public.appointment_status AS ENUM ('scheduled', 'confirmed', 'cancelled', 'completed');
    CREATE TABLE public.patients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text NOT NULL, phone text NOT NULL UNIQUE);
    CREATE TABLE public.appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status public.appointment_status NOT NULL DEFAULT 'scheduled', start_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.message_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), appointment_id uuid, template_name text NOT NULL,
      status text NOT NULL DEFAULT 'sending', created_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO public.appointments (id) VALUES ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002'), ('00000000-0000-4000-8000-000000000003');
    -- Already sent before the migration → backfilled.
    INSERT INTO public.message_deliveries (appointment_id, template_name, status, created_at)
      VALUES ('00000000-0000-4000-8000-000000000003', 'pedir_documentos', 'read', '2026-10-13T10:00:00Z');`);
  await db.exec(sql);

  const backfilled = await db.query<{ t: string }>("SELECT documents_requested_at::text AS t FROM appointments WHERE id = '00000000-0000-4000-8000-000000000003'");
  assert(backfilled.rows[0].t.startsWith("2026-10-13"));

  // Trigger: 'sending' doesn't count; accepted does; another template never.
  await db.exec(`INSERT INTO message_deliveries (id, appointment_id, template_name, status)
    VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'pedir_documentos', 'sending'),
           ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'reservada_estado_cita', 'accepted')`);
  const requested = () => db.query<{ id: string; t: string | null }>("SELECT id::text, documents_requested_at::text AS t FROM appointments ORDER BY id");
  assertEquals((await requested()).rows.slice(0, 2).map((r) => r.t), [null, null]);
  await db.exec("UPDATE message_deliveries SET status = 'accepted' WHERE id = '10000000-0000-4000-8000-000000000001'");
  const first = (await requested()).rows[0].t;
  assert(first);
  await db.exec("UPDATE message_deliveries SET status = 'delivered' WHERE id = '10000000-0000-4000-8000-000000000001'");
  assertEquals((await requested()).rows[0].t, first); // first request time is kept

  // "Sin seguro" can't keep an insurer or a policy.
  await db.exec("INSERT INTO patients (full_name, phone, has_insurance, insurer, policy_number) VALUES ('Ana', '+525512345678', true, 'GNP', 'P1')");
  let rejected = false;
  try {
    await db.exec("UPDATE patients SET has_insurance = false");
  } catch {
    rejected = true;
  }
  assert(rejected);
  await db.exec("UPDATE patients SET has_insurance = false, insurer = NULL, policy_number = NULL");

  const values = await db.query<{ v: string }>("SELECT unnest(enum_range(NULL::notification_type))::text AS v");
  assert(values.rows.some((r) => r.v === "documents_received"));
  await db.close();
});
