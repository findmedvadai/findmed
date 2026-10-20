// Quién se atiende en una cita (garantía 20-oct-2026). Un mismo teléfono (el del
// titular, quien escribe por WhatsApp) puede agendar para su familia:
//   * patients.full_name = titular del teléfono (no cambia al agendar para otro),
//   * appointments.patient_name = quien recibe la atención en ESA cita.
// Las vistas muestran patient_name y, si falta (citas antiguas), el titular.
// Misma regla que `attendedName` en supabase/functions/_shared/patient-identity.ts.

type WithPatient = {
  patient_name?: string | null;
  patients?: { full_name?: string | null } | null;
};

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
};

/** Nombre de quien se atiende en la cita, o `fallback` si no hay ninguno. */
export function appointmentPatientName<F extends string | null = string>(
  appt: WithPatient | null | undefined,
  fallback: F = "Paciente" as F,
): string | F {
  return clean(appt?.patient_name) ?? clean(appt?.patients?.full_name) ?? fallback;
}

/**
 * Nombre del titular cuando es distinto de quien se atiende (para mostrar
 * "Titular: …" junto al nombre). null cuando son la misma persona.
 */
export function titularIfDifferent(appt: WithPatient | null | undefined): string | null {
  const attended = clean(appt?.patient_name);
  const titular = clean(appt?.patients?.full_name);
  if (!attended || !titular) return null;
  return attended.toLowerCase() === titular.toLowerCase() ? null : titular;
}

/** Cuerpo de admin-update-patient-insurance con action "contact" (editor "Editar datos"). */
export interface ContactUpdateBody {
  action: "contact";
  patient_id: string;
  full_name?: string;
  phone?: string;
  appointment_id?: string;
  appointment_patient_name?: string | null;
}

const text = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/** Solo los campos que cambiaron; null si no hay nada que guardar. */
export function contactChanges(
  patientId: string,
  initial: { fullName: string | null | undefined; phone: string | null | undefined; attendedName?: string | null },
  form: { fullName: string; phone: string; attendedName: string },
  appointmentId?: string | null,
): ContactUpdateBody | null {
  const body: ContactUpdateBody = { action: "contact", patient_id: patientId };
  if (text(form.fullName) !== text(initial.fullName)) body.full_name = text(form.fullName);
  if (text(form.phone) !== text(initial.phone)) body.phone = text(form.phone);
  if (appointmentId && text(form.attendedName) !== text(initial.attendedName)) {
    body.appointment_id = appointmentId;
    body.appointment_patient_name = text(form.attendedName) || null;
  }
  return Object.keys(body).length > 2 ? body : null;
}
