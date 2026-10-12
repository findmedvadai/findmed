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
    "Result: data.appointments[] con appointment_id, status, fecha/hora local, médico y consultorio. Si hay más de una, pregunta a cuál se refiere antes de actuar. Lista vacía = no hay citas próximas con ese número.",
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

    return {
      ok: true,
      status: "success",
      data: {
        timezone: "America/Mexico_City",
        appointments: found.appointments.map((a) => {
          const s = localParts(a.start_at);
          const e = localParts(a.end_at);
          const o = a.office_id ? office[a.office_id] : undefined;
          return {
            appointment_id: a.appointment_id,
            status: a.status,
            date: s.date,
            start_time: s.time,
            end_time: e.time,
            doctor_name: doctorName[a.doctor_id] ?? null,
            office_name: o?.name ?? null,
            office_address: o?.address ?? null,
          };
        }),
      },
    };
  },
};

export const TOOLS: ToolDef[] = [
  searchCareOptionsTool,
  listAvailableSlotsTool,
  createBookingLinkTool,
  listMyAppointmentsTool,
];
