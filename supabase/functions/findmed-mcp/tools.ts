// FindMed MCP tool catalog (block B5, capabilities M01/M03/M04/M05 — see
// docs/findmed-migration/decisiones.md A3). Every tool delegates to the shared
// domain in ../_shared; nothing here talks SQL beyond simple reads.
//
// Identity (A2): tools that touch a patient's data take `phone`, which MUST be
// mapped in WHAAPY to {{contact.phoneNumber}} (never extracted by the model).
// The server normalizes it and scopes every read/write to that patient.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type CareOption,
  citiesWithSpecialty,
  NEARBY_LIMIT,
  NEARBY_MAX_KM,
  type NearbyCareOption,
  resolveSearchOrigin,
  searchCareOptions,
  searchNearbyCareOptions,
} from "../_shared/care-search.ts";
import { nextAvailableSlots } from "../_shared/day-slots.ts";
import { findNetworkPlaces, type NetworkKind, NETWORK_DEFAULT_LIMIT, NETWORK_MAX_LIMIT } from "../_shared/network-search.ts";
import { INSURER_MAX, POLICY_MAX, savePatientInsuranceById, savePatientInsuranceByPhone } from "../_shared/patient-insurance.ts";
import { computeDaySlots } from "../_shared/day-slots.ts";
import { createReservationSession } from "../_shared/booking-session.ts";
import { findUpcomingAppointmentsByPhone } from "../_shared/appointment-actions.ts";
import { isValidNormalizedPhone, mxPhoneLookupVariants, normalizeMxPhone } from "../_shared/phone.ts";
import { formatMxLongDateTime, msToMxIso, mxLocalToMs } from "../_shared/mx-time.ts";
import { getOrCreateManageUrl } from "../_shared/manage-token.ts";
import { commitAction, getOperation, prepareAction } from "../_shared/operations.ts";
import { getMyCases, openCase, PRIORITIES, REQUEST_TYPES, requestHandoff, type Priority, type RequestType } from "../_shared/cases.ts";
import { createWhaapyClient, type WhaapyClient } from "../_shared/whaapy-client.ts";
import { scheduleWhaapyContactSync } from "../_shared/whaapy-contact-sync.ts";
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

const optionOut = (o: CareOption) => ({
  doctor_id: o.doctor_id,
  doctor_name: o.doctor_name,
  specialties: o.specialties,
  office_id: o.office_id,
  office_name: o.office_name,
  office_address: o.office_address,
  city: o.city,
  zone: o.zone,
});

// Nearest-options search: an option with distance and its next free slots.
type RankedOption = CareOption & Partial<Pick<NearbyCareOption, "distance_km" | "distance_basis" | "in_requested_zone">>;

const pickDistance = (o: NearbyCareOption | undefined) =>
  o ? { distance_km: o.distance_km, distance_basis: o.distance_basis } : {};

const SLOT_DAYS = 7;
const SLOTS_PER_OPTION = 3;
// WHAAPY cuts tools/call at 30 s (server answers at 25 s): slots get what fits in this budget.
const SLOTS_BUDGET_MS = 12_000;

async function rankedOptionsOut(supabase: SupabaseClient, options: RankedOption[], startedAt: number) {
  const deadlineMs = startedAt + SLOTS_BUDGET_MS;
  return await Promise.all(options.map(async (o) => {
    const next = await nextAvailableSlots(supabase, o.office_id, { days: SLOT_DAYS, max: SLOTS_PER_OPTION, deadlineMs });
    return {
      ...optionOut(o),
      distance_km: o.distance_km ?? null,
      distance_basis: o.distance_basis ?? null,
      in_requested_zone: o.in_requested_zone ?? null,
      next_slots: next.slots.map((s) => ({
        date: s.date,
        time: s.time,
        label: formatMxLongDateTime(mxLocalToMs(s.date, s.time)),
        por_confirmar: s.unverified,
      })),
      // verified | external_calendar_unverified ("por confirmar") | none_in_range (sin horarios en 7 días) | not_checked
      slots_status: next.status,
    };
  }));
}

const searchCareOptionsTool: ToolDef = {
  name: "search_care_options",
  safety: "read_only",
  description: [
    "Busca médicos y consultorios de FindMed por especialidad y ubicación, y cuando el paciente da su colonia, municipio o alcaldía devuelve las opciones MÁS CERCANAS con distancia y próximos horarios.",
    "When to use: SOLO cuando ya sabes QUÉ necesita el paciente (la especialidad que pidió, o la que devolvió suggest_specialty) Y dónde está: ciudad y, si la dijo, zona/colonia/municipio (p. ej. city='Estado de México', zone='Chimalhuacán'; también sirve city='Neza'). Si solo dijo 'quiero una cita', primero pregunta qué necesita.",
    "Never use for: diagnosticar, adivinar la especialidad, ni para decidir que FindMed no puede ayudar.",
    "Result: data.result es 'none', 'one' o 'many'. Con 'many' presenta las opciones y pide que el paciente elija; NUNCA elijas tú la primera. Con 'one' confirma la sede con el paciente. Guarda doctor_id y office_id de la opción elegida para create_booking_link.",
    "Cercanía: cada opción puede traer distance_km (km aproximados en línea recta; si distance_basis='city' di solo la ciudad, sin km), in_requested_zone y next_slots (hasta 3 horarios de los próximos 7 días con label listo para el paciente; por_confirmar=true → di 'por confirmar'; slots_status='none_in_range' → sin horarios esta semana, el enlace muestra más fechas).",
    "Si data.nearest=true (data.requested_location_has_options=false): no hay consultorio en el lugar que dijo (data.requested_location), pero estas SÍ son las más cercanas y se pueden agendar. Sigue data.note: preséntalas directamente (médico · consultorio · zona · ~km · 2–3 horarios) y pregunta cuál le queda mejor. NO pases a una persona como primera respuesta.",
    "Si result='none' NUNCA digas que FindMed no tiene médicos en su zona o ciudad. Revisa data.reason y data.alternatives:",
    "- ambiguous_city / unknown_city / unknown_specialty → haz la nextQuestion (unknown_city trae data.available_cities: ciudades donde sí hay opciones). Si la especialidad no se reconoce y el paciente no sabe cuál necesita, usa suggest_specialty con sus síntomas.",
    "- unknown_zone / no_active_offices con data.alternatives.scope='other_zones' → en su ciudad sí hay opciones en otras zonas: preséntalas (data.alternatives.options, máximo 3, médico · consultorio · zona) o haz la nextQuestion. Las opciones traen doctor_id y office_id válidos.",
    "- data.alternatives.scope='other_cities' → no hay opciones a menos de ~60 km; data.alternatives.cities trae las ciudades con opciones (con distance_km cuando se conoce): ofrécelas con la nextQuestion; si no le sirven, abre caso appointment_help + request_handoff.",
    "- data.escalate=true (sin alternativas) → abre caso appointment_help + request_handoff y di que una persona de FindMed le ayudará a encontrar opción.",
    "Pasa a una persona solo si el paciente rechaza todas las opciones, la pide, o data.escalate=true.",
    "Side effects: ninguno.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["specialty", "city"],
    properties: {
      specialty: { type: "string", minLength: 2, maxLength: 80, description: "Especialidad o especialista, p. ej. 'Ortopedia' u 'ortopedista'." },
      city: { type: "string", minLength: 2, maxLength: 80, description: "Ciudad tal como la dijo el paciente (se aceptan abreviaturas como CDMX)." },
      zone: { type: "string", maxLength: 80, description: "Zona, colonia, alcaldía o municipio tal como lo dijo el paciente (p. ej. 'Chimalhuacán', 'Roma', 'Neza'), opcional pero recomendado: con él se ordenan las opciones por cercanía." },
    },
  },
  async handler(supabase, args) {
    const startedAt = Date.now();
    const especialidad = String(args.specialty);
    const ciudad = String(args.city);
    const zoneAsked = typeof args.zone === "string" && args.zone.trim() !== "";
    const zoneText = zoneAsked ? String(args.zone).trim() : null;
    const r = await searchCareOptions(supabase, { especialidad, ciudad, zona: zoneText });
    if (!r.ok) return fail("temporarily_unavailable", "No pude consultar el catálogo en este momento.");

    const data: Record<string, unknown> & { city: string | null; city_candidates: string[] } = {
      result: r.result,
      reason: r.reason ?? null,
      city: r.city?.name ?? null,
      city_candidates: r.city_candidates?.map((c) => c.name) ?? [],
      zones: r.zones.map((z) => z.name),
      matched_specialties: r.matched_specialties,
      options: r.options.map(optionOut),
      alternatives: null,
      escalate: false,
      requested_location: zoneText,
      requested_location_has_options: null,
      nearest: false,
      max_distance_km: NEARBY_MAX_KM,
      note: null,
    };

    const ask = (nextQuestion: string): ToolOutcome => ({ ok: true, status: "needs_more_info", data, nextQuestion });
    const label = (matched: string[]) => matched[0] ?? especialidad;
    const temporarilyUnavailable = () => fail("temporarily_unavailable", "No pude consultar el catálogo en este momento.");

    if (r.reason === "ambiguous_city") return ask(`¿En cuál de estas ciudades quieres atenderte: ${data.city_candidates.join(", ")}?`);
    if (r.reason === "unknown_specialty") return ask("¿Me confirmas qué especialista buscas o qué te está pasando?");

    // Options in the exact zone the patient named: those first, then (when
    // there are fewer than 3) the nearest others, each with its next slots.
    if (r.result !== "none") {
      if (!zoneText || r.zones.length === 0) return { ok: true, status: "success", data };
      data.requested_location_has_options = true;
      const zoneIds = r.zones.map((z) => z.id);
      const origin = await resolveSearchOrigin(supabase, { zoneText, cityText: ciudad, city: r.city });
      let ranked: RankedOption[] = r.options.map((o) => ({ ...o, in_requested_zone: true }));
      if (origin) {
        data.requested_location = origin.label;
        const near = await searchNearbyCareOptions(supabase, { especialidad, origin: origin.point, requestedZoneIds: zoneIds, limit: NEARBY_LIMIT + r.options.length });
        if (near.ok) {
          const byOffice = new Map(near.options.map((o) => [o.office_id, o]));
          ranked = ranked.map((o) => ({ ...o, ...pickDistance(byOffice.get(o.office_id)) }));
          const fill = near.options.filter((o) => !r.options.some((x) => x.office_id === o.office_id));
          ranked = [...ranked, ...fill.slice(0, Math.max(0, 3 - ranked.length))];
        }
      }
      if (ranked.length <= NEARBY_LIMIT) data.options = await rankedOptionsOut(supabase, ranked, startedAt);
      data.result = ranked.length === 1 ? "one" : "many";
      return { ok: true, status: "success", data };
    }

    // Nothing in the city/zone as named: rank by distance to where the
    // patient is (zone, municipality or the city itself), across cities.
    const origin = await resolveSearchOrigin(supabase, { zoneText, cityText: ciudad, city: r.city });
    if (origin) {
      data.requested_location = origin.label;
      const near = await searchNearbyCareOptions(supabase, { especialidad, origin: origin.point, requestedZoneIds: origin.zone_ids });
      if (!near.ok) return temporarilyUnavailable();
      if (near.options.length > 0) {
        const inPlace = near.options.some((o) => o.in_requested_zone);
        data.result = near.options.length === 1 ? "one" : "many";
        data.reason = null;
        data.matched_specialties = near.matched_specialties;
        data.requested_location_has_options = inPlace;
        data.nearest = !inPlace;
        data.options = await rankedOptionsOut(supabase, near.options, startedAt);
        if (!inPlace) {
          data.note = `No hay consultorio de ${label(near.matched_specialties)} en ${origin.label}; estas son las opciones más cercanas (distancia aproximada en línea recta) y se pueden agendar. ` +
            "Preséntalas directamente con zona, distancia y 2–3 horarios de cada una, y pregunta cuál le queda mejor. " +
            "Pasa a una persona solo si las rechaza todas o la pide.";
        }
        return { ok: true, status: "success", data };
      }
      if (near.nearest_cities_beyond.length > 0) {
        const [first, ...rest] = near.nearest_cities_beyond;
        data.alternatives = {
          scope: "other_cities",
          cities: near.nearest_cities_beyond.map((c) => ({ city: c.city, options: c.options, distance_km: c.distance_km })),
        };
        const others = rest.length > 0 ? ` También tengo en ${rest.map((c) => c.city).join(", ")}.` : "";
        return ask(
          `Cerca de ${origin.label} no tengo consultorio de ${label(near.matched_specialties)}. La opción más cercana está en ${first.city} (a unos ${first.distance_km} km).${others} ¿Te queda bien o prefieres que una persona de FindMed te busque una alternativa más cerca?`,
        );
      }
      // No office of the specialty has coordinates yet: fall back to the
      // catalog-only alternatives below.
    }

    if (r.reason === "unknown_city") {
      // Help the patient place themselves instead of looping on "¿en qué ciudad?".
      const cities = (await citiesWithSpecialty(supabase, especialidad)) ?? [];
      data.available_cities = cities.map((c) => c.city);
      return ask(
        cities.length > 0
          ? `¿En qué ciudad y colonia o municipio quieres atenderte? Tengo opciones en: ${cities.map((c) => c.city).join(", ")}.`
          : "¿En qué ciudad y colonia o municipio quieres atenderte?",
      );
    }

    // unknown_zone / no_active_offices: never answer "no hay médicos en tu
    // zona". First the rest of the same city, then other cities, then a person.
    let cityHasNone = r.reason === "no_active_offices" && !zoneAsked;
    if (zoneAsked) {
      const wide = await searchCareOptions(supabase, { especialidad, ciudad, zona: null });
      if (!wide.ok) return fail("temporarily_unavailable", "No pude consultar el catálogo en este momento.");
      if (wide.result !== "none") {
        const zones = [...new Set(wide.options.map((o) => o.zone).filter((z): z is string => !!z))];
        data.alternatives = {
          scope: "other_zones",
          city: wide.city?.name ?? data.city,
          zones,
          options: wide.options.slice(0, 3).map(optionOut),
        };
        const where = wide.city?.name ?? data.city ?? "tu ciudad";
        return ask(
          zones.length > 0
            ? `En ${where} tengo opciones de ${label(wide.matched_specialties)} en estas zonas: ${zones.join(", ")}. ¿Alguna te queda cerca?`
            : `En ${where} tengo opciones de ${label(wide.matched_specialties)}. ¿Te comparto cuáles son?`,
        );
      }
      if (wide.reason === "unknown_specialty") return ask("¿Me confirmas qué especialista buscas o qué te está pasando?");
      cityHasNone = wide.reason === "no_active_offices";
    }
    if (cityHasNone) {
      const others = await citiesWithSpecialty(supabase, especialidad, r.city ? [r.city.id] : []);
      if (others && others.length > 0) {
        data.alternatives = { scope: "other_cities", cities: others.map((c) => ({ city: c.city, options: c.options })) };
        return ask(
          `Para ${label(r.matched_specialties)} tengo opciones en: ${others.map((c) => c.city).join(", ")}. ¿Te queda bien alguna de esas ciudades o prefieres que una persona de FindMed te busque una alternativa cerca de ti?`,
        );
      }
    }
    data.escalate = true;
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

const createBookingLinkTool = (whaapy: WhaapyClient): ToolDef => ({
  name: "create_booking_link",
  safety: "mutation_limited",
  description: [
    "Genera el enlace personal para que el paciente elija horario y reserve con el médico y consultorio elegidos.",
    "When to use: cuando el paciente ya eligió UNA opción (doctor_id + office_id de search_care_options) y confirmó su nombre.",
    "Never use for: varias opciones a la vez, ni sin que el paciente haya elegido.",
    "Identity: phone mapeado a {{contact.phoneNumber}}. patient_name es el nombre del PACIENTE que recibirá la atención (puede ser distinto de quien escribe).",
    "Side effects: registra/actualiza al paciente y crea una sesión de reserva que vence en 72 horas. NO crea una cita: la cita existe solo cuando el paciente reserva en el enlace. Nunca digas 'tu cita quedó agendada' por haber enviado el enlace.",
    "Seguro (opcional): si el paciente ya te dijo si tiene seguro, su aseguradora o su póliza, pásalos en has_insurance, insurer y policy_number; se guardan en su expediente (data.insurance_saved). Nunca los inventes ni bloquees el enlace por ellos.",
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
      has_insurance: { type: "boolean", description: "Opcional: true si tiene seguro de gastos médicos mayores, false si no tiene." },
      insurer: { type: "string", minLength: 2, maxLength: INSURER_MAX, description: "Opcional: aseguradora tal como la dijo el paciente (p. ej. 'GNP', 'AXA')." },
      policy_number: { type: "string", minLength: 3, maxLength: POLICY_MAX, description: "Opcional: número de póliza tal como lo dio el paciente." },
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

    // Insurance rides along when the agent already has it. A failure here
    // never costs the patient the booking link.
    let insuranceSaved: boolean | null = null;
    const gaveInsurance = typeof args.has_insurance === "boolean" || args.insurer != null || args.policy_number != null;
    if (gaveInsurance) {
      const saved = await savePatientInsuranceById(supabase, r.patient_id, {
        hasInsurance: typeof args.has_insurance === "boolean" ? args.has_insurance : true,
        insurer: args.insurer as string | undefined,
        policyNumber: args.policy_number as string | undefined,
      }, "merge");
      insuranceSaved = saved.ok && saved.saved;
    }

    // Titular name + insurance into the WHAAPY contact (background, best-effort).
    await scheduleWhaapyContactSync(supabase, whaapy, { phone: String(args.phone), patientId: r.patient_id });

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
        insurance_saved: insuranceSaved,
      },
    };
  },
});

// --- Insurance (FindMed decision a) -------------------------------------------

const savePatientInsuranceTool = (whaapy: WhaapyClient): ToolDef => ({
  name: "save_patient_insurance",
  safety: "mutation_limited",
  description: [
    "Guarda en el expediente del paciente si tiene seguro de gastos médicos mayores, su aseguradora y su número de póliza.",
    "When to use: en cuanto el paciente responda si tiene seguro y, si tiene, la aseguradora y la póliza que te dé. Si no tiene la póliza a la mano, guárdala sin policy_number y sigue con el flujo: nunca bloquees la atención por la póliza.",
    "Never use for: inventar o completar datos que el paciente no dio, ni para responder dudas de cobertura o costos.",
    "Identity: phone mapeado a {{contact.phoneNumber}}. patient_name (opcional) es el nombre completo de quien se atiende: si el número todavía no está registrado, solo se guarda cuando lo incluyes.",
    "Result: data.saved=true → quedó guardado (no se lo repitas al paciente). data.saved=false con data.reason='patient_not_registered' → el número aún no está registrado: NO le preguntes nada extra; vuelve a llamarla con patient_name cuando lo tengas o pasa has_insurance/insurer/policy_number en create_booking_link.",
    "Side effects: actualiza el seguro del paciente (o lo registra si incluyes patient_name). has_insurance=false borra aseguradora y póliza anteriores. Repetirla no duplica nada.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["phone", "has_insurance"],
    properties: {
      phone: PHONE_SCHEMA,
      has_insurance: { type: "boolean", description: "true si tiene seguro de gastos médicos mayores; false si no tiene." },
      insurer: { type: "string", minLength: 2, maxLength: INSURER_MAX, description: "Aseguradora tal como la dijo el paciente (p. ej. 'GNP', 'AXA', 'MetLife'). Opcional." },
      policy_number: { type: "string", minLength: 3, maxLength: POLICY_MAX, description: "Número de póliza tal como lo dio el paciente. Opcional." },
      patient_name: { type: "string", minLength: 2, maxLength: 120, description: "Nombre completo de quien recibe la atención, si ya lo tienes. Opcional." },
    },
  },
  async handler(supabase, args) {
    const r = await savePatientInsuranceByPhone(supabase, {
      phone: String(args.phone),
      hasInsurance: args.has_insurance === true,
      insurer: args.insurer as string | undefined,
      policyNumber: args.policy_number as string | undefined,
      patientName: args.patient_name ? String(args.patient_name) : null,
    });
    if (!r.ok) return fail(r.code, r.message_es);
    if (!r.saved) {
      return {
        ok: true,
        status: "success",
        data: {
          saved: false,
          reason: r.reason,
          next_step: "Pasa has_insurance, insurer y policy_number en create_booking_link, o vuelve a llamar con patient_name.",
        },
      };
    }
    // Insurance + titular name into the WHAAPY contact (background, best-effort).
    await scheduleWhaapyContactSync(supabase, whaapy, { phone: String(args.phone), patientId: r.patient_id });
    return {
      ok: true,
      status: "success",
      data: {
        saved: true,
        created_patient: r.created,
        has_insurance: r.state.has_insurance,
        insurer: r.state.insurer,
        policy_number_saved: !!r.state.policy_number,
      },
    };
  },
});

// --- Network hospitals and laboratories (FindMed decision c) -----------------

const NETWORK_LABEL: Record<NetworkKind, { plural: string; key: string }> = {
  hospitals: { plural: "hospitales", key: "hospitals" },
  laboratories: { plural: "laboratorios", key: "laboratories" },
};

async function networkHandler(supabase: SupabaseClient, kind: NetworkKind, args: Record<string, unknown>): Promise<ToolOutcome> {
  const r = await findNetworkPlaces(supabase, kind, {
    city: String(args.city),
    zone: typeof args.zone === "string" ? args.zone : null,
    limit: typeof args.limit === "number" ? args.limit : NETWORK_DEFAULT_LIMIT,
  });
  if (!r.ok) return fail("temporarily_unavailable", "No pude consultar la red de FindMed en este momento.");
  const { key, plural } = NETWORK_LABEL[kind];
  const data: Record<string, unknown> = {
    result: r.result,
    reason: r.reason,
    city: r.city,
    zone: r.zone,
    zone_matched: r.zone_matched,
    city_candidates: r.city_candidates,
    [key]: r.places,
    other_cities: r.other_cities,
    escalate: r.reason === "none_in_city",
  };
  if (r.reason === "ambiguous_city") {
    return { ok: true, status: "needs_more_info", data, nextQuestion: `¿En cuál de estas ciudades estás: ${r.city_candidates.join(", ")}?` };
  }
  if (r.reason === "unknown_city") {
    return { ok: true, status: "needs_more_info", data, nextQuestion: "¿En qué ciudad o municipio te encuentras?" };
  }
  if (r.reason === "none_in_city") {
    data.message_es = `No tengo ${plural} de la red registrados en ${r.city ?? "esa ciudad"}: una persona de FindMed le ayuda a ubicar la mejor opción.`;
  }
  return { ok: true, status: "success", data };
}

const networkSchema = (what: string): Schema => ({
  type: "object",
  additionalProperties: false,
  required: ["city"],
  properties: {
    city: { type: "string", minLength: 2, maxLength: 80, description: `Ciudad o municipio donde está el paciente, tal como lo dijo (acepta CDMX, DF, Edomex o una zona como Naucalpan). Se buscan ${what} de esa ciudad.` },
    zone: { type: "string", maxLength: 80, description: "Zona o colonia, opcional: solo ordena los resultados (primero los de su zona)." },
    limit: { type: "integer", minimum: 1, maximum: NETWORK_MAX_LIMIT, description: `Cuántos devolver (1–${NETWORK_MAX_LIMIT}, default ${NETWORK_DEFAULT_LIMIT}).` },
  },
});

const findNetworkHospitalsTool: ToolDef = {
  name: "find_network_hospitals",
  safety: "read_only",
  description: [
    "Hospitales de la red FindMed en la ciudad (y zona) del paciente: nombre, dirección, teléfono y zona. Solo datos del catálogo de FindMed.",
    "When to use: cuando suggest_specialty devuelve routing='urgencias_hoy' (que lo valoren hoy en urgencias) o cuando el paciente pide un hospital de la red. Después de compartirlos abre open_case (request_type='urgency') + request_handoff.",
    "Never use for: urgencias_inmediato ANTES del 911 (primero la ruta de seguridad: 911 / urgencias más cercana), recomendar hospital por diagnóstico, ni inventar hospitales, direcciones o teléfonos.",
    "Result: data.result none|one|many y data.hospitals[] con name, address, phone, zone, city, in_requested_zone. Comparte de 1 a 3 con nombre, dirección y teléfono; si phone viene null, NO des teléfono.",
    "Si result='none': ambiguous_city → haz la nextQuestion; unknown_city → pregunta la ciudad una vez (nextQuestion) y si sigue sin aparecer, abre el caso; none_in_city → no hay hospital de la red registrado ahí: NO digas que no hay atención, di que una persona de FindMed le ayuda a ubicar la mejor opción (data.other_cities son ciudades con red, solo si puede trasladarse) y abre el caso + request_handoff.",
    "Side effects: ninguno.",
  ].join("\n"),
  inputSchema: networkSchema("hospitales"),
  handler: (supabase, args) => networkHandler(supabase, "hospitals", args),
};

const findNetworkLaboratoriesTool: ToolDef = {
  name: "find_network_laboratories",
  safety: "read_only",
  description: [
    "Laboratorios de la red FindMed en la ciudad (y zona) del paciente: nombre, dirección, teléfono y zona. Solo datos del catálogo de FindMed.",
    "When to use: cuando el paciente necesita hacerse estudios de laboratorio y pregunta dónde; compártelos y abre open_case (request_type='studies') + request_handoff para que una persona le ayude con la orden y la cobertura.",
    "Never use for: indicar qué estudios hacerse, interpretar resultados ni inventar laboratorios, direcciones o teléfonos.",
    "Result: data.result none|one|many y data.laboratories[] con name, address, phone, zone, city, in_requested_zone. Si phone viene null, NO des teléfono.",
    "Si result='none': ambiguous_city / unknown_city → haz la nextQuestion; none_in_city → no hay laboratorio de la red registrado ahí: di que una persona de FindMed le ayuda y abre el caso + request_handoff.",
    "Side effects: ninguno.",
  ].join("\n"),
  inputSchema: networkSchema("laboratorios"),
  handler: (supabase, args) => networkHandler(supabase, "laboratories", args),
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

const openCaseTool = (whaapy: WhaapyClient): ToolDef => ({
  name: "open_case",
  safety: "mutation_limited",
  description: [
    "Registra una solicitud que necesita seguimiento de una persona de FindMed.",
    "When to use: hospital, estudios/laboratorio, urgencia, seguimiento, búsqueda sin opciones automáticas (search_care_options con data.escalate=true, o el paciente no acepta las alternativas), o cuando el paciente pide hablar con una persona.",
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
    // What FindMed knows of this contact (or the name given here) into WHAAPY.
    await scheduleWhaapyContactSync(supabase, whaapy, {
      phone: String(args.phone),
      fallbackName: args.contact_name ? String(args.contact_name) : null,
    });
    return { ok: true, status: "success", data: { case_id: r.case_id, status: r.status, priority: r.priority, deduplicated: r.deduplicated } };
  },
});

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
    createBookingLinkTool(whaapy),
    savePatientInsuranceTool(whaapy),
    listMyAppointmentsTool,
    prepareAppointmentActionTool,
    getOperationStatusTool,
    ...(opts.chatActions ? [commitAppointmentActionTool] : []),
    findNetworkHospitalsTool,
    findNetworkLaboratoriesTool,
    openCaseTool(whaapy),
    requestHandoffTool(whaapy),
    getMyCaseStatusTool,
  ];
}

export const TOOLS: ToolDef[] = buildTools({ chatActions: false });
