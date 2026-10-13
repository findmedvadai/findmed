// FindMed MCP tool catalog (block B5, capabilities M01/M03/M04/M05 — see
// docs/findmed-migration/decisiones.md A3). Every tool delegates to the shared
// domain in ../_shared; nothing here talks SQL beyond simple reads.
//
// Identity (A2): tools that touch a patient's data take `phone`, which MUST be
// mapped in WHAAPY to {{contact.phoneNumber}} (never extracted by the model).
// The server normalizes it and scopes every read/write to that patient.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { searchCareOptions } from "../_shared/care-search.ts";
import { computeDaySlots } from "../_shared/day-slots.ts";
import { createReservationSession } from "../_shared/booking-session.ts";
import { findUpcomingAppointmentsByPhone } from "../_shared/appointment-actions.ts";
import { isValidNormalizedPhone, mxPhoneLookupVariants, normalizeMxPhone } from "../_shared/phone.ts";
import { msToMxIso } from "../_shared/mx-time.ts";
import { getOrCreateManageUrl } from "../_shared/manage-token.ts";
import { commitAction, getOperation, prepareAction } from "../_shared/operations.ts";
import { getMyCases, openCase, PRIORITIES, REQUEST_TYPES, requestHandoff, type Priority, type RequestType } from "../_shared/cases.ts";
import { createWhaapyClient, type WhaapyClient } from "../_shared/whaapy-client.ts";
import { ALL_KEYWORDS, suggestSpecialty } from "../_shared/triage.ts";
import { DATE_PATTERN, type Schema, UUID_PATTERN } from "./schema.ts";

export type Safety = "read_only" | "read_private" | "mutation_limited";

export interface ToolOutcome {
  ok: boolean;
  status: "success" | "failed" | "needs_more_info" | "pending_confirmation" | "queued";
  data?: Record<string, unknown>;
  errors?: { code: string; message_es: string; field?: string; retryable?: boolean }[];
  nextQuestion?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Schema;
  safety: Safety;
  handler: (supabase: SupabaseClient, args: Record<string, unknown>) => Promise<ToolOutcome>;
}

const PHONE_SCHEMA: Schema = {
  type: "string",
  description: "Teléfono del contacto. Mapear SIEMPRE a {{contact.phoneNumber}} en WHAAPY; la IA no debe llenarlo.",
  pattern: "^\\+?[0-9 ()\\-]{8,20}$",
};

const fail = (code: string, message_es: string, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({
  ok: false,
  status: "failed",
  errors: [{ code, message_es, retryable: code === "temporarily_unavailable" }],
  ...extra,
});

function phoneVariantsOrNull(raw: unknown): string[] | null {
  const canonical = normalizeMxPhone(String(raw ?? ""));
  return isValidNormalizedPhone(canonical) ? mxPhoneLookupVariants(canonical) : null;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const localParts = (isoUtc: string) => {
  const local = msToMxIso(Date.parse(isoUtc));
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
};

// ---------------------------------------------------------------------------

const searchCareOptionsTool: ToolDef = {
  name: "search_care_options",
  safety: "read_only",
  description: [
    "Busca médicos y consultorios de FindMed por especialidad y ubicación.",
    "When to use: cuando ya sabes la especialidad (dicha por el paciente o validada) y la ciudad (y opcionalmente zona/colonia).",
    "Never use for: diagnosticar, ni para decidir que FindMed no puede ayudar.",
    "Result: data.result es 'none', 'one' o 'many'. Con 'many' presenta las opciones (médico + consultorio + zona) y pide que el paciente elija; NUNCA elijas tú la primera. Con 'one' confirma la sede con el paciente. Guarda doctor_id y office_id de la opción elegida para create_booking_link.",
    "Si result='none' revisa data.reason: ambiguous_city/unknown_city/unknown_zone/unknown_specialty → usa nextQuestion para aclarar (pide permiso antes de ampliar la búsqueda a toda la ciudad). no_active_offices → esta búsqueda no encontró agenda automática: NO digas que FindMed no atiende; ofrece canalizar con un asesor.",
    "Side effects: ninguno.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["specialty", "city"],
    properties: {
      specialty: { type: "string", minLength: 2, maxLength: 80, description: "Especialidad o especialista, p. ej. 'Ortopedia' u 'ortopedista'." },
      city: { type: "string", minLength: 2, maxLength: 80, description: "Ciudad tal como la dijo el paciente (se aceptan abreviaturas como CDMX)." },
      zone: { type: "string", maxLength: 80, description: "Zona o colonia, opcional." },
    },
  },
  async handler(supabase, args) {
    const r = await searchCareOptions(supabase, {
      especialidad: String(args.specialty),
      ciudad: String(args.city),
      zona: args.zone ? String(args.zone) : null,
    });
    if (!r.ok) return fail("temporarily_unavailable", "No pude consultar el catálogo en este momento.");

    const data = {
      result: r.result,
      reason: r.reason ?? null,
      city: r.city?.name ?? null,
      city_candidates: r.city_candidates?.map((c) => c.name) ?? [],
      zones: r.zones.map((z) => z.name),
      matched_specialties: r.matched_specialties,
      options: r.options.map((o) => ({
        doctor_id: o.doctor_id,
        doctor_name: o.doctor_name,
        specialties: o.specialties,
        office_id: o.office_id,
        office_name: o.office_name,
        office_address: o.office_address,
        city: o.city,
        zone: o.zone,
      })),
    };

    const questions: Record<string, string> = {
      ambiguous_city: `¿En cuál de estas ciudades quieres atenderte: ${data.city_candidates.join(", ")}?`,
      unknown_city: "¿En qué ciudad quieres atenderte?",
      unknown_zone: `No encontré esa zona en ${data.city ?? "esa ciudad"}. ¿Quieres que busque en toda la ciudad?`,
      unknown_specialty: "¿Me confirmas qué especialista buscas?",
    };
    if (r.result === "none" && r.reason && questions[r.reason]) {
      return { ok: true, status: "needs_more_info", data, nextQuestion: questions[r.reason] };
    }
    return { ok: true, status: "success", data };
  },
};

const listAvailableSlotsTool: ToolDef = {
  name: "list_available_slots",
  safety: "read_only",
  description: [
    "Horarios disponibles de un consultorio, en hora del centro de México (America/Mexico_City).",
    "When to use: después de que el paciente eligió médico y consultorio con search_care_options, si quiere saber horarios antes de recibir el enlace.",
    "Never use for: reservar. Los horarios pueden ocuparse en cualquier momento; la reserva se hace en el enlace de create_booking_link.",
    "Result: data.days[] con date, slots ('HH:mm') y availability_status. Si availability_status es 'external_calendar_unverified', presenta los horarios como 'por confirmar' (no se pudo revisar el calendario del médico). Otros estados: past_date, office_unavailable, no_weekly_availability, day_blocked.",
    "Side effects: ninguno.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["office_id", "date"],
    properties: {
      office_id: { type: "string", pattern: UUID_PATTERN, description: "office_id de la opción elegida." },
      date: { type: "string", pattern: DATE_PATTERN, description: "Primer día a consultar, YYYY-MM-DD (hora del centro)." },
      days: { type: "integer", minimum: 1, maximum: 5, description: "Días consecutivos a consultar (1–5, default 1)." },
    },
  },
  async handler(supabase, args) {
    const days = typeof args.days === "number" ? args.days : 1;
    const out: { date: string; slots: string[]; availability_status: string }[] = [];
    let duration: number | null = null;
    for (let i = 0; i < days; i++) {
      const date = addDays(String(args.date), i);
      const r = await computeDaySlots(supabase, String(args.office_id), date);
      if (!r.ok) {
        return {
          ok: false,
          status: "needs_more_info",
          errors: [{ code: "invalid_date", field: "date", message_es: "La fecha debe tener formato AAAA-MM-DD." }],
          nextQuestion: "¿Qué día te gustaría?",
        };
      }
      if (r.value.availability_status === "office_unavailable") {
        return fail("office_unavailable", "Ese consultorio no está disponible para reservar.");
      }
      duration = r.value.duration_minutes;
      out.push({ date, slots: r.value.slots, availability_status: r.value.availability_status });
    }
    return {
      ok: true,
      status: "success",
      data: { office_id: args.office_id, timezone: "America/Mexico_City", duration_minutes: duration, days: out },
    };
  },
};

const createBookingLinkTool: ToolDef = {
  name: "create_booking_link",
  safety: "mutation_limited",
  description: [
    "Genera el enlace personal para que el paciente elija horario y reserve con el médico y consultorio elegidos.",
    "When to use: cuando el paciente ya eligió UNA opción (doctor_id + office_id de search_care_options) y confirmó su nombre.",
    "Never use for: varias opciones a la vez, ni sin que el paciente haya elegido.",
    "Identity: phone mapeado a {{contact.phoneNumber}}. patient_name es el nombre del PACIENTE que recibirá la atención (puede ser distinto de quien escribe).",
    "Side effects: registra/actualiza al paciente y crea una sesión de reserva que vence en 72 horas. NO crea una cita: la cita existe solo cuando el paciente reserva en el enlace. Nunca digas 'tu cita quedó agendada' por haber enviado el enlace.",
    "Success criteria: ok=true y data.reserve_url presente.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["phone", "patient_name", "doctor_id", "office_id"],
    properties: {
      phone: PHONE_SCHEMA,
      patient_name: { type: "string", minLength: 2, maxLength: 120, description: "Nombre completo del paciente." },
      doctor_id: { type: "string", pattern: UUID_PATTERN },
      office_id: { type: "string", pattern: UUID_PATTERN },
      symptoms: { type: "string", maxLength: 500, description: "Resumen breve del motivo de consulta, opcional." },
    },
  },
  async handler(supabase, args) {
    const r = await createReservationSession(supabase, {
      doctorId: String(args.doctor_id),
      officeId: String(args.office_id),
      patientName: String(args.patient_name),
      patientPhone: String(args.phone),
      symptoms: args.symptoms ? String(args.symptoms) : null,
    });
    if (!r.ok) {
      if (r.code === "db_error") return fail("temporarily_unavailable", r.message_es);
      return fail(r.code, r.message_es);
    }
    return {
      ok: true,
      status: "success",
      data: {
        link_created: true,
        appointment_created: false,
        reserve_url: r.reserve_url,
        expires_at: r.expires_at,
        session_id: r.session_id,
        doctor_name: r.doctor_name,
        office_name: r.office_name,
        office_address: r.office_address,
      },
    };
  },
};

const listMyAppointmentsTool: ToolDef = {
  name: "list_my_appointments",
  safety: "read_private",
  description: [
    "Lista las citas próximas (agendadas o confirmadas) del contacto que está escribiendo.",
    "When to use: cuando el paciente pregunta por su cita, quiere confirmarla, cancelarla o reagendarla, o antes de cualquier acción sobre una cita.",
    "Identity: phone mapeado a {{contact.phoneNumber}}. Solo devuelve citas de ese teléfono.",
    "Result: data.appointments[] con appointment_id, status, fecha/hora local, médico, consultorio y manage_url (enlace seguro donde el paciente ve, confirma, cancela o reagenda esa cita). Si hay más de una, pregunta a cuál se refiere antes de actuar. Lista vacía = no hay citas próximas con ese número.",
    "Side effects: ninguno.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["phone"],
    properties: { phone: PHONE_SCHEMA },
  },
  async handler(supabase, args) {
    const variants = phoneVariantsOrNull(args.phone);
    if (!variants) return fail("invalid_phone", "No pude identificar el número de este contacto.");
    const found = await findUpcomingAppointmentsByPhone(supabase, variants);
    if (!found.ok) return fail("temporarily_unavailable", "No pude consultar las citas en este momento.");
    if (found.appointments.length === 0) return { ok: true, status: "success", data: { appointments: [] } };

    const doctorIds = [...new Set(found.appointments.map((a) => a.doctor_id))];
    const officeIds = [...new Set(found.appointments.map((a) => a.office_id).filter((o): o is string => !!o))];
    const [{ data: doctors }, { data: offices }] = await Promise.all([
      supabase.from("doctors").select("id, full_name").in("id", doctorIds),
      officeIds.length
        ? supabase.from("doctor_offices").select("id, name, address").in("id", officeIds)
        : Promise.resolve({ data: [] as { id: string; name: string; address: string | null }[] }),
    ]);
    const doctorName = Object.fromEntries((doctors ?? []).map((d) => [d.id, d.full_name]));
    const office = Object.fromEntries((offices ?? []).map((o) => [o.id, o]));
    const canonical = normalizeMxPhone(String(args.phone));

    // Secure /gestionar link per appointment (view, confirm, cancel or
    // reschedule there). A token problem leaves it null, never fails the list.
    const appointments = await Promise.all(found.appointments.map(async (a) => {
      const s = localParts(a.start_at);
      const e = localParts(a.end_at);
      const o = a.office_id ? office[a.office_id] : undefined;
      let manageUrl: string | null = null;
      try {
        manageUrl = await getOrCreateManageUrl({ supabase, appointmentId: a.appointment_id, endAt: a.end_at, patientPhone: canonical });
      } catch (err) {
        console.error("[findmed-mcp] manage url failed", err);
      }
      return {
        appointment_id: a.appointment_id,
        status: a.status,
        date: s.date,
        start_time: s.time,
        end_time: e.time,
        doctor_name: doctorName[a.doctor_id] ?? null,
        office_name: o?.name ?? null,
        office_address: o?.address ?? null,
        manage_url: manageUrl,
      };
    }));

    return { ok: true, status: "success", data: { timezone: "America/Mexico_City", appointments } };
  },
};

const ACTION_SCHEMA: Schema = {
  type: "string",
  enum: ["confirm", "cancel"],
  description: "confirm = confirmar asistencia; cancel = cancelar la cita.",
};

const prepareAppointmentActionTool: ToolDef = {
  name: "prepare_appointment_action",
  safety: "read_private",
  description: [
    "Prepara confirmar o cancelar UNA cita del paciente. No cambia nada todavía.",
    "When to use: cuando el paciente pide confirmar o cancelar y ya sabes cuál cita (appointment_id de list_my_appointments). Si tiene varias, pregunta primero cuál.",
    "Never use for: reagendar (usa el enlace manage_url), ni citas de otra persona.",
    "Identity: phone mapeado a {{contact.phoneNumber}}; solo funciona con citas de ese teléfono.",
    "Result: data.summary (fecha, hora, médico, consultorio) para que el paciente confirme lo que se hará, data.operation_id (vence en 15 min) y data.manage_url: enlace seguro donde el paciente puede hacerlo él mismo.",
    "Si commit_appointment_action no está disponible, envía data.manage_url para que el paciente confirme o cancele desde ahí. Nunca digas que la cita ya se confirmó o canceló con este paso.",
    "Side effects: ninguno sobre la cita (solo registra la intención).",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["phone", "appointment_id", "action"],
    properties: {
      phone: PHONE_SCHEMA,
      appointment_id: { type: "string", pattern: UUID_PATTERN },
      action: ACTION_SCHEMA,
    },
  },
  async handler(supabase, args) {
    const r = await prepareAction(supabase, {
      phone: String(args.phone),
      appointmentId: String(args.appointment_id),
      action: args.action as "confirm" | "cancel",
      channel: "mcp",
    });
    if (!r.ok) return fail(r.code, r.message_es);
    return {
      ok: true,
      status: "pending_confirmation",
      data: {
        operation_id: r.operation_id,
        action: r.action,
        expires_at: r.expires_at,
        summary: r.summary,
        manage_url: r.manage_url,
      },
    };
  },
};

const getOperationStatusTool: ToolDef = {
  name: "get_operation_status",
  safety: "read_private",
  description: [
    "Consulta el estado de una acción preparada o ejecutada (operation_id).",
    "When to use: después de un error de red o timeout, ANTES de reintentar; o si el paciente pregunta si su confirmación/cancelación quedó.",
    "Identity: phone mapeado a {{contact.phoneNumber}}.",
    "Result: data.status = pending_confirmation | executing | succeeded | failed | expired, y data.result.",
    "Side effects: ninguno.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["phone", "operation_id"],
    properties: { phone: PHONE_SCHEMA, operation_id: { type: "string", pattern: UUID_PATTERN } },
  },
  async handler(supabase, args) {
    const r = await getOperation(supabase, { phone: String(args.phone), operationId: String(args.operation_id) });
    if (!r.ok) return fail(r.code, r.message_es);
    return { ok: true, status: "success", data: { operation_id: r.operation_id, status: r.status, action: r.action, result: r.result, expires_at: r.expires_at } };
  },
};

const commitAppointmentActionTool: ToolDef = {
  name: "commit_appointment_action",
  safety: "mutation_limited",
  description: [
    "Ejecuta una acción preparada con prepare_appointment_action, una sola vez.",
    "When to use: SOLO después de mostrar data.summary al paciente y de que él responda explícitamente que sí (por ejemplo 'sí, cancélala').",
    "Never use for: acciones que el paciente no confirmó en su último mensaje, ni para reintentar a ciegas: si hubo error, usa get_operation_status primero.",
    "Identity: phone mapeado a {{contact.phoneNumber}}.",
    "Result: status success con data.new_status cuando se ejecutó; failed con errors si la cita ya no lo permite; si se repite la misma operación devuelve el resultado original (data.replayed=true).",
    "Side effects: cambia el estado de la cita, borra el evento del calendario al cancelar y avisa al médico.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["phone", "operation_id"],
    properties: { phone: PHONE_SCHEMA, operation_id: { type: "string", pattern: UUID_PATTERN } },
  },
  async handler(supabase, args) {
    const r = await commitAction(supabase, {
      phone: String(args.phone),
      operationId: String(args.operation_id),
      evidence: { type: "chat_confirmation" },
    });
    if (!("operation_id" in r)) return fail(r.code, r.message_es);
    const data = { operation_id: r.operation_id, status: r.status, replayed: r.replayed, ...(r.result ?? {}) };
    if (r.status === "succeeded") return { ok: true, status: "success", data };
    if (r.status === "executing") return { ok: true, status: "queued", data };
    if (r.status === "expired") {
      return { ok: false, status: "failed", data, errors: [{ code: "expired", message_es: "La solicitud venció; prepárala de nuevo.", retryable: true }] };
    }
    const code = String((r.result as { code?: string } | null)?.code ?? "failed");
    const message_es = String((r.result as { message_es?: string } | null)?.message_es ?? "No se pudo completar la acción.");
    return { ok: false, status: "failed", data, errors: [{ code, message_es }] };
  },
};

// --- Specialty orientation (M02, F10) ---------------------------------------

const suggestSpecialtyTool: ToolDef = {
  name: "suggest_specialty",
  safety: "read_only",
  description: [
    "Orienta con qué especialista debe consultar el paciente según sus síntomas, con el catálogo de triaje de FindMed. NO diagnostica.",
    "When to use: el paciente tiene un malestar y no sabe con quién ir, y YA reuniste 2-3 características (síntoma principal + dónde + desde cuándo o algo asociado) y confirmó que no quiere agregar nada.",
    "Never use for: el primer síntoma suelto, ni cuando el paciente ya sabe qué especialista quiere (usa search_care_options).",
    "Input: keywords = términos estandarizados del catálogo (enum), 1 a 10. Incluye síntoma principal + zona del cuerpo + lo asociado + contexto clínico si lo dijo (embarazo, diabetes, cáncer, quimioterapia, caída, golpe, presión alta, riñón). NO conviertas la intensidad en keyword. La DURACIÓN sí: empezó de golpe, hoy o ayer → subito; meses o años, o va y viene desde hace tiempo → cronico; semanas → ninguna.",
    "Traducción del lenguaje del paciente: panza/estómago/barriga → abdomen · boca del estómago → abdomen_superior · bajo vientre → abdomen_inferior · lado derecho/izquierdo de la panza → abdomen_derecho/abdomen_izquierdo · espalda baja/cintura → columna_lumbar · agruras/acidez/reflujo → acidez · chorrillo/diarrea → diarrea · no puedo ir al baño (días) → estrenimiento · calentura → fiebre · se ve chueco → deformidad · se me hinchó → inflamacion · me ahogo/falta de aire → dificultad_respirar · mocos/nariz tapada → congestion_nasal · se me durmió/entumido → entumecimiento · no tengo fuerza/no lo puedo apoyar → perdida_fuerza · me brinca el corazón → palpitaciones · sudo frío → sudoracion · veo borroso/lucecitas → vision_alterada · ojo rojo → ojo + ojo_rojo · no me salen las palabras → dificultad_hablar · me sangra la nariz → nariz + sangrado · sangra mucho / no para → sangrado_abundante · cólicos/regla → menstruacion (+ dolor, pelvis) · sangro entre periodos → intermenstrual + sangrado_uterino · orino sangre → hematuria · ardor al orinar → ardor · orino muy seguido / chorro débil / me levanto de noche a orinar → orinar_frecuente · no puedo orinar nada / no controlo la orina o la popó → retencion_urinaria · popó negra → heces_negras · sangro al ir al baño → sangrado_rectal · bolita → bulto · seno/pecho de mujer (bolita) → mama · comezón → comezon · me caí → caida · me pegué → golpe · ronco → ronquido · dejo de respirar dormido → apnea · silbidos en el pecho → sibilancias · flujo con mal olor → flujo_vaginal · me sale pus → pus + secrecion · tengo la presión alta → presion_alta · me salió alterado un estudio (potasio, creatinina) → estudio_alterado · revisión/chequeo/Papanicolaou → chequeo · tobillo/muñeca/codo/cadera → tobillo/muneca/codo/cadera.",
    "Result: data.result = 'one' | 'tie' | 'none'.",
    "- 'one': data.best trae patient_label (cómo decírselo al paciente), routing, alarm_signals y search_specialties. routing manda: urgencias_inmediato → ruta de seguridad, sin recomendar consulta; urgencias_hoy → indica que lo valoren hoy en urgencias y pasa a una persona, sin agendar; consulta_mismo_dia / consulta → pregunta antes las alarm_signals en UNA sola pregunta (si confirma alguna, ruta de seguridad) y luego recomienda con patient_label.",
    "- 'tie': hay condiciones empatadas que cambian el especialista o la urgencia (data.candidates, cada una con pregunta_diferencial). NO le digas al paciente que hay duda: haz UNA pregunta (usa pregunta_diferencial si viene), agrega el término que resulte y vuelve a llamar.",
    "- 'none': haz más preguntas sobre el síntoma y vuelve a llamar; nunca digas que no encontraste nada.",
    "Para buscar médico usa search_care_options con el primer nombre de data.best.search_specialties (si no hay opciones, prueba el siguiente). Si search_specialties viene vacío, FindMed no tiene esa especialidad: abre un caso y pasa a una persona.",
    "Si falla con catalog_unavailable: abre un caso (appointment_help) con el resumen de síntomas y pasa a una persona.",
    "Side effects: ninguno.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["keywords"],
    properties: {
      keywords: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: { type: "string", enum: [...ALL_KEYWORDS] },
        description: "Términos estandarizados del catálogo (solo estos valores).",
      },
    },
  },
  async handler(supabase, args) {
    const r = await suggestSpecialty(supabase, (args.keywords as string[]) ?? []);
    if (!r.ok) return fail(r.code, r.message_es);
    if (r.result === "none") {
      return {
        ok: true,
        status: "needs_more_info",
        data: { result: "none", keywords_used: r.keywords_used },
        nextQuestion: "¿Me cuentas un poco más? ¿En qué parte del cuerpo lo sientes y qué otra molestia has notado?",
      };
    }
    return {
      ok: true,
      status: r.result === "tie" ? "needs_more_info" : "success",
      data: {
        result: r.result,
        best: r.best,
        candidates: r.candidates,
        keywords_used: r.keywords_used,
        broadened: r.broadened,
      },
    };
  },
};

// --- Cases and human handoff (B6: M09/M10/M11) -----------------------------

const openCaseTool: ToolDef = {
  name: "open_case",
  safety: "mutation_limited",
  description: [
    "Registra una solicitud que necesita seguimiento de una persona de FindMed.",
    "When to use: hospital, estudios/laboratorio, urgencia, seguimiento, búsqueda sin opciones automáticas (result='none' por no_active_offices), o cuando el paciente pide hablar con una persona.",
    "Never use for: solicitudes que ya resolviste con search_care_options + create_booking_link.",
    "Identity: phone mapeado a {{contact.phoneNumber}}.",
    "request_type: appointment_help | hospital | studies | urgency | follow_up | other. priority: normal | high | urgent (urgency → urgent).",
    "summary: 1–3 frases con lo indispensable (qué necesita, para quién, dónde). Sin diagnósticos ni datos que el paciente no dio.",
    "Result: data.case_id y data.status. Si data.deduplicated=true ya existía una solicitud igual abierta: no la dupliques.",
    "Next step: si el paciente necesita a una persona, llama request_handoff con data.case_id.",
    "Side effects: crea (o reutiliza) un caso visible para el equipo de FindMed. No asigna a nadie ni detiene la IA.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["phone", "request_type", "summary"],
    properties: {
      phone: PHONE_SCHEMA,
      request_type: { type: "string", enum: [...REQUEST_TYPES] },
      summary: { type: "string", minLength: 3, maxLength: 1000 },
      priority: { type: "string", enum: [...PRIORITIES] },
      contact_name: { type: "string", maxLength: 120, description: "Nombre que dio el paciente, si lo dio." },
      city: { type: "string", maxLength: 80 },
      zone: { type: "string", maxLength: 80 },
    },
  },
  async handler(supabase, args) {
    const r = await openCase(supabase, {
      phone: String(args.phone),
      requestType: args.request_type as RequestType,
      summary: String(args.summary),
      priority: args.priority as Priority | undefined,
      contactName: args.contact_name ? String(args.contact_name) : null,
      city: args.city ? String(args.city) : null,
      zone: args.zone ? String(args.zone) : null,
    });
    if (!r.ok) return fail(r.code, r.message_es);
    return { ok: true, status: "success", data: { case_id: r.case_id, status: r.status, priority: r.priority, deduplicated: r.deduplicated } };
  },
};

const requestHandoffTool = (whaapy: WhaapyClient): ToolDef => ({
  name: "request_handoff",
  safety: "mutation_limited",
  description: [
    "Pasa la conversación a una persona del equipo de FindMed para un caso abierto con open_case.",
    "When to use: el paciente pide una persona, es una urgencia, o no hay solución automática y el paciente acepta que lo contacte un asesor.",
    "Identity: phone mapeado a {{contact.phoneNumber}}; el case_id debe ser de ese mismo contacto.",
    "Result: data.assignment = 'awaiting_assignment' (nadie lo ha tomado aún) o 'assigned' (una persona ya lo tiene). data.ai_paused=true significa que dejarás de responder en esta conversación.",
    "Qué decir: con awaiting_assignment, que su solicitud quedó registrada y que una persona del equipo de FindMed la tomará; NO digas que ya hay un asesor asignado ni prometas un tiempo de respuesta. Con assigned, que una persona de FindMed ya lleva su caso.",
    "Si data.ai_paused=false, la canalización quedó registrada pero sigues activo: continúa ayudando sin contradecir lo anterior.",
    "Side effects: marca el caso en espera de asignación, apaga la IA en esta conversación y etiqueta el contacto. Repetir la llamada no duplica nada.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["phone", "case_id", "reason"],
    properties: {
      phone: PHONE_SCHEMA,
      case_id: { type: "string", pattern: UUID_PATTERN },
      reason: { type: "string", minLength: 3, maxLength: 500, description: "Por qué se canaliza (p. ej. 'paciente pide asesor', 'urgencia', 'sin opciones en su ciudad')." },
      priority: { type: "string", enum: [...PRIORITIES] },
    },
  },
  async handler(supabase, args) {
    const r = await requestHandoff(supabase, whaapy, {
      phone: String(args.phone),
      caseId: String(args.case_id),
      reason: String(args.reason),
      priority: args.priority as Priority | undefined,
    });
    if (!r.ok) return fail(r.code, r.message_es);
    return {
      ok: true,
      status: r.assignment === "assigned" ? "success" : "queued",
      data: { case_id: r.case_id, status: r.status, assignment: r.assignment, ai_paused: r.ai_paused, replayed: r.replayed },
    };
  },
});

const getMyCaseStatusTool: ToolDef = {
  name: "get_my_case_status",
  safety: "read_private",
  description: [
    "Consulta el estado de las solicitudes (casos) recientes del contacto que escribe.",
    "When to use: el paciente pregunta qué pasó con su solicitud, hospital, estudios o con el asesor.",
    "Identity: phone mapeado a {{contact.phoneNumber}}; solo devuelve casos de ese teléfono (últimos 30 días).",
    "Result: data.cases[] con case_id, request_type, status y status_es (frase lista para el paciente). Lista vacía = no hay solicitudes recientes con ese número.",
    "Side effects: ninguno.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["phone"],
    properties: { phone: PHONE_SCHEMA },
  },
  async handler(supabase, args) {
    const r = await getMyCases(supabase, String(args.phone));
    if (!r.ok) return fail(r.code, r.message_es);
    return { ok: true, status: "success", data: { cases: r.cases } };
  },
};

/**
 * Tool catalog. `chatActions` publishes commit_appointment_action, which lets
 * the agent execute after the patient's explicit "yes" in chat. It stays OFF
 * (env MCP_CHAT_ACTIONS_ENABLED) until FindMed accepts chat confirmation as
 * evidence or the WhatsApp-button path (A4/A6) is in place; meanwhile the agent
 * prepares the action and sends the secure /gestionar link.
 */
export function buildTools(opts: { chatActions: boolean; whaapy?: WhaapyClient }): ToolDef[] {
  const whaapy = opts.whaapy ?? createWhaapyClient();
  return [
    suggestSpecialtyTool,
    searchCareOptionsTool,
    listAvailableSlotsTool,
    createBookingLinkTool,
    listMyAppointmentsTool,
    prepareAppointmentActionTool,
    getOperationStatusTool,
    ...(opts.chatActions ? [commitAppointmentActionTool] : []),
    openCaseTool,
    requestHandoffTool(whaapy),
    getMyCaseStatusTool,
  ];
}

export const TOOLS: ToolDef[] = buildTools({ chatActions: false });
