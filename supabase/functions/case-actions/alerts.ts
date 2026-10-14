// Staff-alert administration (Configuración → Alertas). Admin JWT, same
// function as the case actions; the page reads the tables through RLS and
// every write comes through here so phones are normalized with _shared/phone.ts
// and the WHAAPY key never reaches the browser.
//
//   { action: "alert_recipient_save", id?, name, phone, receives: "all" | "urgent_only", is_active }
//       → 200 { recipient }
//   { action: "alert_recipient_delete", id }                 → 200 { deleted: true }
//   { action: "alert_settings_save", template_name, template_language?, sla_urgent_minutes,
//       sla_high_minutes, sla_normal_minutes, max_escalations, whatsapp_enabled }
//       → 200 { settings }
//   { action: "alert_test", recipient_id? | phone? }        → 200 { delivery_id, status, message } | 4xx/502
//
// Returns null when the action is not one of these (handler.ts goes on).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";
import { normalizeRecipientPhone, sendTestAlert } from "../_shared/staff-alerts.ts";
import type { WhaapyClient } from "../_shared/whaapy-client.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ALERT_ACTIONS = ["alert_recipient_save", "alert_recipient_delete", "alert_settings_save", "alert_test"] as const;

const bad = (error: string, message: string, status = 400) => jsonResponse({ error, message }, status);

interface AlertDeps {
  supabase: SupabaseClient;
  whaapy: WhaapyClient;
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

async function saveRecipient(b: Record<string, unknown>, deps: AlertDeps): Promise<Response> {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 120) return bad("invalid_name", "Escribe el nombre (máximo 120 caracteres).");
  const phone = typeof b.phone === "string" ? normalizeRecipientPhone(b.phone) : null;
  if (!phone) return bad("invalid_phone", "Número inválido. Usa 10 dígitos o el formato internacional (+52…).");
  const receives = b.receives ?? "all";
  if (receives !== "all" && receives !== "urgent_only") return bad("invalid_receives", "Preferencia inválida.");
  if (b.is_active !== undefined && typeof b.is_active !== "boolean") return bad("invalid_is_active", "Estado inválido.");
  const fields = { name, phone, receives, is_active: b.is_active !== false };

  let result;
  if (b.id !== undefined && b.id !== null) {
    if (typeof b.id !== "string" || !UUID_RE.test(b.id)) return bad("invalid_id", "id inválido");
    result = await deps.supabase.from("staff_alert_recipients").update(fields).eq("id", b.id).select("*").maybeSingle();
    if (!result.error && !result.data) return bad("not_found", "No encontré ese número de guardia.", 404);
  } else {
    result = await deps.supabase.from("staff_alert_recipients").insert(fields).select("*").single();
  }
  if (result.error) {
    if ((result.error as { code?: string }).code === "23505") return bad("phone_taken", "Ese número ya está registrado.", 409);
    console.error("[case-actions] recipient save failed", result.error.message);
    return bad("temporarily_unavailable", "No se pudo guardar el número.", 503);
  }
  return jsonResponse({ recipient: result.data });
}

async function deleteRecipient(b: Record<string, unknown>, deps: AlertDeps): Promise<Response> {
  if (typeof b.id !== "string" || !UUID_RE.test(b.id)) return bad("invalid_id", "id inválido");
  const { error } = await deps.supabase.from("staff_alert_recipients").delete().eq("id", b.id);
  if (error) return bad("temporarily_unavailable", "No se pudo eliminar el número.", 503);
  return jsonResponse({ deleted: true });
}

/** Validation for the settings form (Spanish messages); exported for tests. */
export function parseAlertSettings(b: Record<string, unknown>): { ok: true; fields: Record<string, unknown> } | { ok: false; message: string } {
  const template = typeof b.template_name === "string" ? b.template_name.trim() : "";
  if (!/^[a-z0-9_]{1,512}$/.test(template)) {
    return { ok: false, message: "El nombre de la plantilla solo lleva minúsculas, números y guiones bajos (como en WHAAPY)." };
  }
  const language = b.template_language === undefined ? "es_MX" : b.template_language;
  if (typeof language !== "string" || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) return { ok: false, message: "Idioma inválido (ej. es_MX)." };
  const { sla_urgent_minutes: u, sla_high_minutes: h, sla_normal_minutes: n, max_escalations: m } = b;
  if (!isInt(u, 1, 1440) || !isInt(h, 1, 1440) || !isInt(n, 1, 10080)) {
    return { ok: false, message: "Los tiempos van en minutos enteros: urgente y alta de 1 a 1440, normal de 1 a 10080." };
  }
  if (!(u <= h && h <= n)) return { ok: false, message: "El tiempo de urgente no puede ser mayor que el de alta, ni el de alta mayor que el de normal." };
  if (!isInt(m, 0, 10)) return { ok: false, message: "Los re-avisos van de 0 a 10." };
  if (typeof b.whatsapp_enabled !== "boolean") return { ok: false, message: "Indica si se envía WhatsApp." };
  return {
    ok: true,
    fields: {
      template_name: template,
      template_language: language,
      sla_urgent_minutes: u,
      sla_high_minutes: h,
      sla_normal_minutes: n,
      max_escalations: m,
      whatsapp_enabled: b.whatsapp_enabled,
    },
  };
}

async function saveSettings(b: Record<string, unknown>, deps: AlertDeps, userId: string): Promise<Response> {
  const parsed = parseAlertSettings(b);
  if (!parsed.ok) return bad("invalid_settings", parsed.message);
  const patch = { ...parsed.fields, updated_by: userId };
  let { data, error } = await deps.supabase.from("staff_alert_settings").update(patch).eq("id", true).select("*").maybeSingle();
  if (!error && !data) {
    // The migration seeds the row; recreate it if someone removed it.
    ({ data, error } = await deps.supabase.from("staff_alert_settings").insert({ id: true, ...patch }).select("*").single());
  }
  if (error) {
    console.error("[case-actions] alert settings save failed", error.message);
    return bad("temporarily_unavailable", "No se pudo guardar la configuración.", 503);
  }
  return jsonResponse({ settings: data });
}

async function testAlert(b: Record<string, unknown>, deps: AlertDeps, userId: string): Promise<Response> {
  const recipientId = typeof b.recipient_id === "string" ? b.recipient_id : null;
  if (recipientId && !UUID_RE.test(recipientId)) return bad("invalid_id", "id inválido");
  const phone = typeof b.phone === "string" ? b.phone : null;
  if (!recipientId && !phone) return bad("invalid_phone", "Elige un número de guardia.");
  const r = await sendTestAlert(deps.supabase, deps.whaapy, { recipientId, phone, userId });
  if (r.ok) return jsonResponse({ delivery_id: r.delivery_id, status: r.status, message: r.message_es });
  const status = r.code === "not_found" ? 404 : r.code === "invalid_phone" ? 400 : r.code === "whaapy_unavailable" ? 503 : 502;
  return jsonResponse({ error: r.code, message: r.message_es, delivery_id: r.delivery_id ?? null }, status);
}

/** Handles the staff-alert actions; null for any other action. Caller already authorized an admin. */
export async function handleAlertAction(
  body: Record<string, unknown>,
  deps: AlertDeps,
  userId: string,
): Promise<Response | null> {
  switch (body.action) {
    case "alert_recipient_save":
      return saveRecipient(body, deps);
    case "alert_recipient_delete":
      return deleteRecipient(body, deps);
    case "alert_settings_save":
      return saveSettings(body, deps, userId);
    case "alert_test":
      return testAlert(body, deps, userId);
    default:
      return null;
  }
}
