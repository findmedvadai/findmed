// Admin messaging center actions (B7b, D8): template catalog, event → template
// mapping, owner switch per event and manual resend. Reads for the page go
// straight to the tables through RLS; everything that writes or talks to
// WHAAPY goes through here (admin JWT), so the API key never reaches the browser.
//
// POST { action, ... } → 200 { ... } | 4xx { error, message }
//   templates                         → normalized WHAAPY catalog
//   sync_templates                    → POST /templates/v1/sync
//   set_owner   { event_type, owner } → switching to 'findmed' requires every
//                                       enabled step to fit its template
//   save_step   { step }              → insert/update one mapping row (validated)
//   delete_step { id }
//   resend      { delivery_id, confirm_duplicate_risk? } → new manual delivery
//   retry_outbox { outbox_id }        → failed event back to the queue

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { type CatalogTemplate, normalizeTemplate, validateStep } from "../_shared/template-catalog.ts";
import type { WhaapyClient } from "../_shared/whaapy-client.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNERS = ["n8n", "findmed", "none"];
const STATUSES = ["scheduled", "confirmed", "cancelled", "completed"];

export interface MessagingAdminDeps {
  supabase: SupabaseClient;
  whaapy: WhaapyClient;
  /** Integration facts for the "health" action (URLs and which secrets exist — never their values). */
  integration?: {
    mcpUrl: string;
    webhookUrl: string;
    secrets: Record<string, boolean>;
  };
  authorize: (req: Request) => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;
}

const bad = (error: string, message: string, status = 400) => jsonResponse({ error, message }, status);

async function catalog(whaapy: WhaapyClient): Promise<{ ok: true; templates: CatalogTemplate[] } | { ok: false; status: number; error: string }> {
  if (!whaapy.configured) return { ok: false, status: 503, error: "WHAAPY no está configurado (falta WHAAPY_API_KEY)." };
  const r = await whaapy.listTemplates();
  if (!r.ok) return { ok: false, status: 502, error: `WHAAPY respondió ${r.status}: ${r.error}` };
  return { ok: true, templates: r.data.map(normalizeTemplate) };
}

const findTemplate = (templates: CatalogTemplate[], name: string, language: string) =>
  templates.find((t) => t.name === name && t.language === language) ?? templates.find((t) => t.name === name);

export async function handleMessagingAdmin(req: Request, deps: MessagingAdminDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad("method_not_allowed", "Método no permitido", 405);
  const auth = await deps.authorize(req);
  if (!auth.ok) return bad(auth.status === 403 ? "forbidden" : "unauthorized", auth.error, auth.status);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return bad("invalid_json", "Cuerpo inválido");
  }
  const { supabase, whaapy } = deps;

  switch (b.action) {
    case "health": {
      // Live check of the WHAAPY API plus what FindMed has configured.
      let whaapyApi: Record<string, unknown> = { configured: whaapy.configured, ok: false };
      if (whaapy.configured) {
        const started = Date.now();
        const r = await whaapy.listTemplates();
        whaapyApi = r.ok
          ? { configured: true, ok: true, latency_ms: Date.now() - started, templates: r.data.length, approved: r.data.filter((t) => String(t.status).toUpperCase() === "APPROVED").length }
          : { configured: true, ok: false, http_status: r.status, error: r.error };
      }
      return jsonResponse({
        whaapy_api: whaapyApi,
        mcp_url: deps.integration?.mcpUrl ?? null,
        webhook_url: deps.integration?.webhookUrl ?? null,
        secrets: deps.integration?.secrets ?? {},
        checked_at: new Date().toISOString(),
      });
    }

    case "templates": {
      const c = await catalog(whaapy);
      if (!c.ok) return bad("whaapy_unavailable", c.error, c.status);
      return jsonResponse({ templates: c.templates.sort((x, y) => x.name.localeCompare(y.name)) });
    }

    case "sync_templates": {
      if (!whaapy.configured) return bad("whaapy_unavailable", "WHAAPY no está configurado.", 503);
      const r = await whaapy.syncTemplates();
      if (!r.ok) return bad("whaapy_unavailable", `WHAAPY respondió ${r.status}: ${r.error}`, 502);
      return jsonResponse({ synced: true });
    }

    case "set_owner": {
      const eventType = String(b.event_type ?? "");
      const owner = String(b.owner ?? "");
      if (!OWNERS.includes(owner)) return bad("invalid_owner", "Dueño inválido");
      const { data: route } = await supabase.from("message_routes").select("event_type").eq("event_type", eventType).maybeSingle();
      if (!route) return bad("not_found", "Evento desconocido", 404);
      if (owner === "findmed") {
        // Don't hand an event to FindMed if any of its messages would fail.
        const c = await catalog(whaapy);
        if (!c.ok) return bad("whaapy_unavailable", c.error, c.status);
        const { data: steps } = await supabase.from("message_route_steps").select("*").eq("event_type", eventType).eq("enabled", true);
        const problems = ((steps ?? []) as Record<string, unknown>[]).flatMap((s) =>
          validateStep(s as never, findTemplate(c.templates, String(s.template_name), String(s.language))).map((p) => `${s.template_name}: ${p}`)
        );
        if (problems.length) return jsonResponse({ error: "invalid_steps", message: "Hay mensajes que no coinciden con su plantilla.", problems }, 409);
      }
      await supabase.from("message_routes").update({ owner, updated_by: auth.userId }).eq("event_type", eventType);
      return jsonResponse({ event_type: eventType, owner });
    }

    case "save_step": {
      const s = (b.step ?? {}) as Record<string, unknown>;
      const step = {
        event_type: String(s.event_type ?? ""),
        when_status: s.when_status ? String(s.when_status) : null,
        when_cancel_reason: s.when_cancel_reason ? String(s.when_cancel_reason) : null,
        position: Number(s.position),
        template_name: String(s.template_name ?? "").trim(),
        language: String(s.language ?? "es_MX"),
        body_params: Array.isArray(s.body_params) ? s.body_params.map(String) : [],
        url_button_param: s.url_button_param ? String(s.url_button_param) : null,
        quick_reply_action: s.quick_reply_action ? String(s.quick_reply_action) : null,
        enabled: s.enabled !== false,
      };
      if (!Number.isInteger(step.position) || step.position < 1 || step.position > 20) return bad("invalid_step", "Posición inválida (1–20).");
      if (step.when_status && !STATUSES.includes(step.when_status)) return bad("invalid_step", "Estado inválido.");
      if (step.when_status && step.event_type !== "appointment.status_changed") return bad("invalid_step", "El estado solo aplica al evento de cambio de estado.");
      if (step.url_button_param && step.url_button_param !== "manage_token") return bad("invalid_step", "Enlace inválido.");
      if (step.quick_reply_action && !["confirm", "cancel"].includes(step.quick_reply_action)) return bad("invalid_step", "Botón inválido.");
      const { data: route } = await supabase.from("message_routes").select("event_type").eq("event_type", step.event_type).maybeSingle();
      if (!route) return bad("not_found", "Evento desconocido", 404);

      const c = await catalog(whaapy);
      if (!c.ok) return bad("whaapy_unavailable", c.error, c.status);
      const problems = validateStep(step, findTemplate(c.templates, step.template_name, step.language));
      if (problems.length) return jsonResponse({ error: "invalid_step", message: problems.join(" "), problems }, 422);

      const id = typeof s.id === "string" && UUID_RE.test(s.id) ? s.id : null;
      const { data, error } = id
        ? await supabase.from("message_route_steps").update(step).eq("id", id).select("*").single()
        : await supabase.from("message_route_steps").insert(step).select("*").single();
      if (error) {
        const dup = (error as { code?: string }).code === "23505";
        return bad(dup ? "position_taken" : "db_error", dup ? "Ya hay un mensaje en esa posición." : "No se pudo guardar.", dup ? 409 : 500);
      }
      return jsonResponse({ step: data });
    }

    case "delete_step": {
      if (typeof b.id !== "string" || !UUID_RE.test(b.id)) return bad("invalid_id", "id inválido");
      await supabase.from("message_route_steps").delete().eq("id", b.id);
      return jsonResponse({ deleted: true });
    }

    case "resend": {
      if (typeof b.delivery_id !== "string" || !UUID_RE.test(b.delivery_id)) return bad("invalid_id", "id inválido");
      const { data: d } = await supabase.from("message_deliveries").select("*").eq("id", b.delivery_id).maybeSingle();
      const delivery = d as Record<string, unknown> | null;
      if (!delivery) return bad("not_found", "Envío no encontrado", 404);
      const status = String(delivery.status);
      if (!["failed", "uncertain"].includes(status)) return bad("not_resendable", "Solo se reenvían mensajes fallidos o inciertos.", 409);
      if (status === "uncertain" && b.confirm_duplicate_risk !== true) {
        return bad("confirm_required", "Este mensaje pudo haber llegado: reenviarlo puede duplicarlo. Confirma para continuar.", 409);
      }
      if (!delivery.request) return bad("not_resendable", "No hay copia del mensaje original.", 409);
      if (!whaapy.configured) return bad("whaapy_unavailable", "WHAAPY no está configurado.", 503);

      const { data: ins } = await supabase.from("message_deliveries").insert({
        appointment_id: delivery.appointment_id,
        to_phone: delivery.to_phone,
        template_name: delivery.template_name,
        language: delivery.language,
        request: delivery.request,
        status: "sending",
        attempts: 1,
        source: "manual",
        sent_by: auth.userId,
      }).select("id").single();
      const newId = (ins as { id: string } | null)?.id;
      const r = await whaapy.sendMessage(delivery.request as Record<string, unknown>);
      const patch = r.ok
        ? { status: "accepted", whaapy_message_id: r.data.message_id, wamid: r.data.wamid }
        : { status: r.status === 0 ? "uncertain" : "failed", error_code: String(r.status), error_message: r.error };
      if (newId) await supabase.from("message_deliveries").update(patch).eq("id", newId);
      return jsonResponse({ delivery_id: newId ?? null, ...patch }, r.ok ? 200 : 502);
    }

    case "retry_outbox": {
      if (typeof b.outbox_id !== "string" || !UUID_RE.test(b.outbox_id)) return bad("invalid_id", "id inválido");
      const { data } = await supabase
        .from("domain_outbox")
        .update({ status: "pending", next_attempt_at: new Date().toISOString(), attempts: 0, last_error: null, processed_at: null })
        .eq("id", b.outbox_id)
        .eq("status", "failed")
        .select("id");
      if (!data || (data as unknown[]).length === 0) return bad("not_retryable", "Solo se reintentan eventos fallidos.", 409);
      return jsonResponse({ queued: true });
    }

    default:
      return bad("invalid_action", "Acción inválida");
  }
}
