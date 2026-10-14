// Etapa 2 — rutas operativas automáticas después de la post-consulta.
//
// The doctor confirms a management type in the post-consultation form
// (conservador | estudios | procedimiento | urgente). When the form is
// submitted, dispatch-webhook (service role) calls routePostConsultation and
// every route opens — or adds an event to — the case the team works on:
//
//   urgente                               → urgency   (urgent) — the alert comes from openCase
//   procedimiento / hospitalización       → procedure (high)
//   estudios / imagen / laboratorio       → studies   (normal) with the detail
//   referencia a especialista             → referral  (normal)
//   conservador                           → follow_up (normal) due in 7 days,
//                                           next action "Llamar al paciente para seguimiento"
//
// Rules:
//  * Everything is read from the DB (form, appointment, patient, doctor); the
//    event payload is never trusted for who the case is about.
//  * Idempotent: post_consultation_case_links keeps one row per (form, route),
//    so re-sending the same form changes nothing. "One active case per phone +
//    type" (openCase) still holds: if the patient already has an active case of
//    that type, it only receives an event (outcome "appended").
//  * Nothing is sent to the patient here. Staff notifications/alerts are
//    openCase's job, so they are not duplicated.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openCase, type Priority, type RequestType } from "./cases.ts";
import { msToMxIso } from "./mx-time.ts";

export const MANAGEMENT_TYPES = ["conservador", "estudios", "procedimiento", "urgente"] as const;
export type ManagementType = (typeof MANAGEMENT_TYPES)[number];

export const isManagementType = (v: unknown): v is ManagementType =>
  typeof v === "string" && (MANAGEMENT_TYPES as readonly string[]).includes(v);

/** Fields of post_consultation_forms the routes look at. */
export interface PostConsultFields {
  observations?: string | null;
  prescribed_medications?: string | null;
  imaging_studies?: string | null;
  lab_tests?: string | null;
  specialist_referral?: string | null;
  hospitalization?: string | null;
  management_type?: string | null;
}

const has = (v: string | null | undefined): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Suggestion shown to the doctor (same rule as src/lib/management-type.ts):
 * hospitalization → procedimiento; imaging or lab → estudios; else conservador.
 * "urgente" is never suggested: only the doctor can say it.
 */
export function suggestManagementType(f: PostConsultFields): ManagementType {
  if (has(f.hospitalization)) return "procedimiento";
  if (has(f.imaging_studies) || has(f.lab_tests)) return "estudios";
  return "conservador";
}

/** What the doctor confirmed, or the suggestion for forms sent before the selector existed. */
export function effectiveManagementType(f: PostConsultFields): ManagementType {
  return isManagementType(f.management_type) ? f.management_type : suggestManagementType(f);
}

export interface PlannedRoute {
  requestType: RequestType;
  priority: Priority;
  summary: string;
  nextAction: string;
  dueInDays?: number;
}

const clip = (v: string, max: number) => {
  const t = v.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
/** " Label: text." (adds the final period only when missing). */
const part = (label: string, v: string | null | undefined, max = 280) => {
  if (!has(v)) return "";
  const t = clip(v, max);
  return ` ${label}: ${t}${/[.!?…]$/.test(t) ? "" : "."}`;
};

/** Pure: which cases a form produces, most urgent first. */
export function planRoutes(f: PostConsultFields, ctx: { doctorName: string | null; when: string }): PlannedRoute[] {
  const type = effectiveManagementType(f);
  const header = `Post-consulta${ctx.doctorName ? ` con ${ctx.doctorName}` : ""} (${ctx.when}).`;
  const routes: PlannedRoute[] = [];

  if (type === "urgente") {
    routes.push({
      requestType: "urgency",
      priority: "urgent",
      summary: `${header} El médico marcó el manejo como URGENTE.${part("Observaciones", f.observations, 400)}`,
      nextAction: "Contactar al paciente de inmediato",
    });
  }
  if (type === "procedimiento" || has(f.hospitalization)) {
    routes.push({
      requestType: "procedure",
      priority: "high",
      summary: `${header} Requiere coordinar procedimiento u hospitalización.${part("Detalle", f.hospitalization)}`,
      nextAction: "Coordinar el procedimiento u hospitalización",
    });
  }
  if (type === "estudios" || has(f.imaging_studies) || has(f.lab_tests)) {
    routes.push({
      requestType: "studies",
      priority: "normal",
      summary: `${header} Requiere estudios.${part("Imagen", f.imaging_studies)}${part("Laboratorio", f.lab_tests)}`,
      nextAction: "Coordinar los estudios con el paciente",
    });
  }
  if (has(f.specialist_referral)) {
    routes.push({
      requestType: "referral",
      priority: "normal",
      summary: `${header} Referencia a especialista.${part("Detalle", f.specialist_referral)}`,
      nextAction: "Agendar la cita con el especialista",
    });
  }
  if (type === "conservador") {
    routes.push({
      requestType: "follow_up",
      priority: "normal",
      summary: `${header} Manejo conservador: dar seguimiento al paciente.${part("Medicamentos", f.prescribed_medications)}`,
      nextAction: "Llamar al paciente para seguimiento",
      dueInDays: 7,
    });
  }
  return routes;
}

/** "2026-10-12T16:30:00Z" → "12/10/2026 10:30" (CDMX). */
export function mxShortDateTime(iso: string): string {
  const local = msToMxIso(Date.parse(iso)); // YYYY-MM-DDTHH:mm:00-06:00
  return `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 16)}`;
}

export type RouteOutcome = {
  request_type: RequestType;
  outcome: "created" | "appended" | "already" | "failed";
  case_id: string | null;
  code?: string;
};

export type RoutePostConsultResult =
  | { ok: true; form_id: string; management_type: ManagementType; routes: RouteOutcome[] }
  | { ok: false; code: "form_not_found" | "appointment_not_found" | "patient_not_found" };

interface FormRow extends PostConsultFields {
  id: string;
  appointment_id: string;
}

/**
 * Opens the cases for the latest post-consultation form of an appointment.
 * Safe to call any number of times for the same form.
 */
export async function routePostConsultation(
  supabase: SupabaseClient,
  appointmentId: string,
  now = Date.now(),
): Promise<RoutePostConsultResult> {
  const { data: formData } = await supabase
    .from("post_consultation_forms")
    .select("*")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const form = formData as FormRow | null;
  if (!form) return { ok: false, code: "form_not_found" };

  const { data: apptData } = await supabase
    .from("appointments")
    .select("id, doctor_id, patient_id, start_at")
    .eq("id", appointmentId)
    .maybeSingle();
  const appt = apptData as { id: string; doctor_id: string; patient_id: string; start_at: string } | null;
  if (!appt) return { ok: false, code: "appointment_not_found" };

  const { data: patientData } = await supabase
    .from("patients")
    .select("id, full_name, phone")
    .eq("id", appt.patient_id)
    .maybeSingle();
  const patient = patientData as { id: string; full_name: string | null; phone: string } | null;
  if (!patient) return { ok: false, code: "patient_not_found" };

  const { data: doctorData } = await supabase
    .from("doctors")
    .select("full_name")
    .eq("id", appt.doctor_id)
    .maybeSingle();
  const doctorName = (doctorData as { full_name: string | null } | null)?.full_name?.trim() || null;

  const { data: linkData } = await supabase
    .from("post_consultation_case_links")
    .select("request_type, case_id")
    .eq("form_id", form.id);
  const done = new Map(((linkData ?? []) as { request_type: string; case_id: string }[]).map((l) => [l.request_type, l.case_id]));

  const managementType = effectiveManagementType(form);
  const plan = planRoutes(form, { doctorName, when: mxShortDateTime(appt.start_at) });
  const routes: RouteOutcome[] = [];

  for (const route of plan) {
    const already = done.get(route.requestType);
    if (already) {
      routes.push({ request_type: route.requestType, outcome: "already", case_id: already });
      continue;
    }
    const r = await openCase(supabase, {
      phone: patient.phone,
      requestType: route.requestType,
      summary: route.summary,
      priority: route.priority,
      contactName: patient.full_name,
      source: "post_consultation",
      actor: "system",
      patientId: patient.id,
      appointmentId: appt.id,
      nextAction: route.nextAction,
      dueAt: route.dueInDays ? new Date(now + route.dueInDays * 86_400_000).toISOString() : null,
      eventDetail: {
        origin: "post_consultation",
        post_consultation_form_id: form.id,
        appointment_id: appt.id,
        management_type: managementType,
      },
    });
    if (!r.ok) {
      console.error("[postconsult-routes] openCase failed", route.requestType, r.code);
      routes.push({ request_type: route.requestType, outcome: "failed", case_id: null, code: r.code });
      continue;
    }
    const outcome = r.deduplicated ? "appended" : "created";
    const { error } = await supabase.from("post_consultation_case_links").insert({
      form_id: form.id,
      request_type: route.requestType,
      case_id: r.case_id,
      outcome,
    });
    // 23505: a concurrent call for the same form linked it first — same case either way.
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("[postconsult-routes] link insert failed", route.requestType, (error as { message?: string }).message);
    }
    routes.push({ request_type: route.requestType, outcome, case_id: r.case_id });
  }

  return { ok: true, form_id: form.id, management_type: managementType, routes };
}
