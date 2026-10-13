// B7b — admin messaging center: template validation, owner switch guard,
// mapping edits and manual resend (X13, R38, N23).
//
//   npm run test:edge

import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { countVariables, normalizeTemplate, validateStep } from "../functions/_shared/template-catalog.ts";
import type { WhaapyClient, WhaapyResult, WhaapySent } from "../functions/_shared/whaapy-client.ts";
import { handleMessagingAdmin } from "../functions/messaging-admin/handler.ts";
import { FakeDb } from "./fake-supabase.ts";

const ADMIN = "11111111-aaaa-4aaa-8aaa-111111111111";

// Shapes as returned by GET /templates/v1 (read from the real account on 12-oct).
const RAW_TEMPLATES = [
  {
    name: "confirmada_estado_cita", category: "UTILITY", language: "es_MX", status: "APPROVED",
    components: [
      { type: "BODY", text: "¡Perfecto {{1}}! 🙌 Gracias por confirmar tu cita." },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Gestionar Cita", url: "https://app.findmed.com.mx/gestionar?token={{1}}" }] },
    ],
  },
  {
    name: "boton_cancelar_cita", category: "MARKETING", language: "es_MX", status: "APPROVED",
    components: [
      { type: "BODY", text: "Cancela aquí tu cita:" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Cancelar cita", buttonId: "cancelar_cita" }] },
    ],
  },
  {
    name: "en_revision", category: "UTILITY", language: "es_MX", status: "PENDING",
    components: [{ type: "BODY", text: "Hola {{1}}" }],
  },
];

function whaapy(sendResult?: WhaapyResult<WhaapySent>) {
  const sent: Record<string, unknown>[] = [];
  const client: WhaapyClient = {
    configured: true,
    conversationByPhone: () => Promise.resolve({ ok: true, status: 200, data: null }),
    setAiEnabled: () => Promise.resolve({ ok: true, status: 200, data: {} }),
    listAgents: () => Promise.resolve({ ok: true, status: 200, data: [] }),
    updateContact: () => Promise.resolve({ ok: true, status: 200, data: {} }),
    sendMessage: (b) => {
      sent.push(b);
      return Promise.resolve(sendResult ?? { ok: true, status: 200, data: { message_id: "new-msg", wamid: null } });
    },
    listTemplates: () => Promise.resolve({ ok: true, status: 200, data: RAW_TEMPLATES }),
    syncTemplates: () => Promise.resolve({ ok: true, status: 200, data: {} }),
  };
  return { client, sent };
}

const step = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), event_type: "appointment.status_changed", when_status: "confirmed", when_cancel_reason: null,
  position: 1, template_name: "confirmada_estado_cita", language: "es_MX", body_params: ["patient_name"],
  url_button_param: "manage_token", quick_reply_action: null, enabled: true, ...over,
});

function db() {
  return new FakeDb({
    message_routes: [{ event_type: "appointment.status_changed", owner: "n8n" }],
    message_route_steps: [step(), step({ position: 2, template_name: "boton_cancelar_cita", body_params: [], url_button_param: null, quick_reply_action: "cancel" })],
    message_deliveries: [
      { id: "aaaaaaaa-0000-4000-8000-000000000001", status: "failed", to_phone: "+525512345678", template_name: "confirmada_estado_cita", language: "es_MX", request: { to: "+525512345678", type: "template" }, appointment_id: null },
      { id: "aaaaaaaa-0000-4000-8000-000000000002", status: "uncertain", to_phone: "+525512345678", template_name: "confirmada_estado_cita", language: "es_MX", request: { to: "+525512345678" }, appointment_id: null },
      { id: "aaaaaaaa-0000-4000-8000-000000000003", status: "delivered", to_phone: "+525512345678", template_name: "x", language: "es_MX", request: {}, appointment_id: null },
    ],
    domain_outbox: [
      { id: "bbbbbbbb-0000-4000-8000-000000000001", status: "failed", attempts: 5 },
      { id: "bbbbbbbb-0000-4000-8000-000000000002", status: "sent", attempts: 1 },
    ],
  });
}

const post = (d: FakeDb, w: WhaapyClient, body: unknown, authOk = true) =>
  handleMessagingAdmin(new Request("https://x", { method: "POST", body: JSON.stringify(body) }), {
    supabase: d as unknown as SupabaseClient,
    whaapy: w,
    authorize: () => Promise.resolve(authOk ? { ok: true as const, userId: ADMIN } : { ok: false as const, status: 403, error: "Forbidden" }),
  });

Deno.test("template catalog: normalize and count variables", () => {
  assertEquals(countVariables("Hola {{1}}, {{2}} y otra vez {{1}}"), 2);
  const t = normalizeTemplate(RAW_TEMPLATES[0]);
  assertEquals([t.body_variables, t.buttons[0].type], [1, "URL"]);
  assertEquals(normalizeTemplate(RAW_TEMPLATES[1]).buttons[0].button_id, "cancelar_cita");
});

Deno.test("validateStep catches mismatches before they reach a patient", () => {
  const tpl = RAW_TEMPLATES.map(normalizeTemplate);
  const base = { template_name: "confirmada_estado_cita", language: "es_MX", body_params: ["patient_name"], url_button_param: "manage_token", quick_reply_action: null };
  assertEquals(validateStep(base, tpl[0]), []);
  assertEquals(validateStep({ ...base, body_params: [] }, tpl[0]).length, 1);
  assertEquals(validateStep({ ...base, url_button_param: null }, tpl[0]).length, 1);
  assertEquals(validateStep({ ...base, body_params: ["telefono"] }, tpl[0]).length, 1);
  assertEquals(validateStep({ ...base, quick_reply_action: "cancel" }, tpl[0]).length, 1);
  assert(validateStep({ ...base, template_name: "en_revision", url_button_param: null }, tpl[2])[0].includes("no está aprobada"));
  assert(validateStep(base, undefined)[0].includes("no existe"));
});

Deno.test("messaging-admin: auth and catalog", async () => {
  const w = whaapy();
  assertEquals((await post(db(), w.client, { action: "templates" }, false)).status, 403);
  const r = await post(db(), w.client, { action: "templates" });
  assertEquals(r.status, 200);
  assertEquals((await r.json()).templates.map((t: { name: string }) => t.name), ["boton_cancelar_cita", "confirmada_estado_cita", "en_revision"]);
  assertEquals((await post(db(), { ...w.client, configured: false }, { action: "templates" })).status, 503);
});

Deno.test("R38/X13: switching an event to FindMed requires every message to fit its template", async () => {
  const d = db();
  const w = whaapy();
  const ok = await post(d, w.client, { action: "set_owner", event_type: "appointment.status_changed", owner: "findmed" });
  assertEquals(ok.status, 200);
  assertEquals(d.rows("message_routes")[0].owner, "findmed");
  assertEquals(d.rows("message_routes")[0].updated_by, ADMIN);

  const d2 = db();
  d2.rows("message_route_steps")[0].body_params = []; // broken mapping
  const blocked = await post(d2, w.client, { action: "set_owner", event_type: "appointment.status_changed", owner: "findmed" });
  assertEquals(blocked.status, 409);
  assertEquals((await blocked.json()).problems.length, 1);
  assertEquals(d2.rows("message_routes")[0].owner, "n8n");

  // Going back to n8n (rollback) never needs validation.
  assertEquals((await post(d2, w.client, { action: "set_owner", event_type: "appointment.status_changed", owner: "n8n" })).status, 200);
  assertEquals((await post(d2, w.client, { action: "set_owner", event_type: "nope", owner: "n8n" })).status, 404);
});

Deno.test("save_step validates against the live template; delete_step removes", async () => {
  const d = db();
  const w = whaapy();
  const bad = await post(d, w.client, { action: "save_step", step: { event_type: "appointment.status_changed", when_status: "confirmed", position: 3, template_name: "confirmada_estado_cita", body_params: [] } });
  assertEquals(bad.status, 422);
  const good = await post(d, w.client, { action: "save_step", step: { event_type: "appointment.status_changed", when_status: "confirmed", position: 3, template_name: "confirmada_estado_cita", body_params: ["patient_name"], url_button_param: "manage_token" } });
  assertEquals(good.status, 200);
  assertEquals(d.rows("message_route_steps").length, 3);
  const wrongEvent = await post(d, w.client, { action: "save_step", step: { event_type: "appointment.reminder_48h", when_status: "confirmed", position: 1, template_name: "x" } });
  assertEquals(wrongEvent.status, 400);

  const id = d.rows("message_route_steps")[2].id;
  assertEquals((await post(d, w.client, { action: "delete_step", id })).status, 200);
  assertEquals(d.rows("message_route_steps").length, 2);
});

Deno.test("N23: resend creates a new manual delivery; an uncertain one needs explicit confirmation", async () => {
  const d = db();
  const w = whaapy();
  const r = await post(d, w.client, { action: "resend", delivery_id: "aaaaaaaa-0000-4000-8000-000000000001" });
  assertEquals(r.status, 200);
  const created = d.rows("message_deliveries").at(-1)!;
  assertEquals([created.source, created.sent_by, created.status, created.whaapy_message_id], ["manual", ADMIN, "accepted", "new-msg"]);
  assertEquals(d.rows("message_deliveries")[0].status, "failed"); // original kept as history

  const needs = await post(d, w.client, { action: "resend", delivery_id: "aaaaaaaa-0000-4000-8000-000000000002" });
  assertEquals([needs.status, (await needs.json()).error], [409, "confirm_required"]);
  assertEquals((await post(d, w.client, { action: "resend", delivery_id: "aaaaaaaa-0000-4000-8000-000000000002", confirm_duplicate_risk: true })).status, 200);
  assertEquals((await post(d, w.client, { action: "resend", delivery_id: "aaaaaaaa-0000-4000-8000-000000000003" })).status, 409);
  assertEquals(w.sent.length, 2);
});

Deno.test("retry_outbox only re-queues failed events", async () => {
  const d = db();
  const w = whaapy();
  assertEquals((await post(d, w.client, { action: "retry_outbox", outbox_id: "bbbbbbbb-0000-4000-8000-000000000001" })).status, 200);
  assertEquals([d.rows("domain_outbox")[0].status, d.rows("domain_outbox")[0].attempts], ["pending", 0]);
  assertEquals((await post(d, w.client, { action: "retry_outbox", outbox_id: "bbbbbbbb-0000-4000-8000-000000000002" })).status, 409);
});
