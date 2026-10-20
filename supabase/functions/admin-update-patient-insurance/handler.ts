// Admin edits a patient from the panel. Separate from index.ts so tests can
// inject the database, the authorization check and the WHAAPY client.
//
// Two actions on one function (the name stays for compatibility):
//
// 1. Insurance (default, no `action` or action = "insurance") — FindMed decision a.
//    POST { patient_id, has_insurance: true | false | null, insurer?, policy_number? }
//    → 200 { patient: { id, has_insurance, insurer, policy_number } }
//    "replace" semantics: what the form sends is what stays (blank = empty).
//    has_insurance null = "No capturado"; false = "Sin seguro" (clears insurer
//    and policy).
//
// 2. Contact (action = "contact") — garantía 20-oct-2026, "poder modificar datos
//    del contacto y beneficiario".
//    POST { action: "contact", patient_id, full_name?, phone?,
//           appointment_id?, appointment_patient_name? }
//    → 200 { patient: { id, full_name, phone }, appointment?: { id, patient_name } }
//    * full_name: the titular (owner of the phone). Renaming the titular also
//      renames the appointments that showed the old titular name (they were
//      the titular's own); appointments of a relative keep their name.
//    * phone: normalized with normalizeMxPhone; 409 phone_taken when another
//      patient already has it (any +52/+521 variant).
//    * appointment_patient_name: who is attended in that appointment (must be
//      the patient's); blank = same as the titular (NULL).
//
// After a successful save, both actions project the patient into the WHAAPY
// contact (whaapy-contact-sync.ts), in the background and best-effort.
//
// Every error is { error: <code>, message: <es> }.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { INSURER_MAX, POLICY_MAX, savePatientInsuranceById } from "../_shared/patient-insurance.ts";
import { isValidNormalizedPhone, mxPhoneLookupVariants, normalizeMxPhone } from "../_shared/phone.ts";
import { cleanPersonName, PERSON_NAME_MAX } from "../_shared/patient-identity.ts";
import type { WhaapyClient } from "../_shared/whaapy-client.ts";
import { scheduleWhaapyContactSync } from "../_shared/whaapy-contact-sync.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PatientInsuranceDeps {
  supabase: SupabaseClient;
  authorize: (req: Request) => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;
  /** WHAAPY client for the contact sync; omitted = no sync (tests that don't care). */
  whaapy?: WhaapyClient | null;
}

const optionalText = (v: unknown, max: number): string | null | false => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length > max * 2) return false;
  return v;
};

const err = (status: number, error: string, message: string) => jsonResponse({ error, message }, status);

export async function handlePatientInsurance(req: Request, deps: PatientInsuranceDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return err(405, "method_not_allowed", "Método no permitido");

  const auth = await deps.authorize(req);
  if (!auth.ok) {
    return err(auth.status, auth.status === 403 ? "forbidden" : "unauthorized", "No tienes permiso para editar los datos del paciente.");
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "invalid_json", "Cuerpo inválido");
  }
  if (typeof body.patient_id !== "string" || !UUID_RE.test(body.patient_id)) {
    return err(400, "invalid_patient_id", "Paciente inválido.");
  }
  if (body.action === "contact") return updateContact(body, deps, auth.userId);
  if (body.action !== undefined && body.action !== "insurance") {
    return err(400, "invalid_action", "Acción no válida.");
  }

  if (body.has_insurance !== true && body.has_insurance !== false && body.has_insurance !== null) {
    return err(400, "invalid_has_insurance", "Indica si tiene seguro, si no tiene o si no se ha capturado.");
  }
  const insurer = optionalText(body.insurer, INSURER_MAX);
  const policy = optionalText(body.policy_number, POLICY_MAX);
  if (insurer === false || policy === false) {
    return err(400, "invalid_text", "La aseguradora o la póliza no son válidas.");
  }

  const r = await savePatientInsuranceById(deps.supabase, body.patient_id, {
    hasInsurance: body.has_insurance,
    insurer,
    policyNumber: policy,
  }, "replace");
  if (!r.ok) return err(r.code === "not_found" ? 404 : 500, r.code, r.message_es);
  if (!r.saved) return err(500, "not_saved", "No se pudo guardar.");

  console.log(JSON.stringify({ event: "patient_insurance_updated", patient_id: r.patient_id, by: auth.userId }));
  await scheduleWhaapyContactSync(deps.supabase, deps.whaapy, { patientId: r.patient_id });
  return jsonResponse({
    patient: {
      id: r.patient_id,
      has_insurance: r.state.has_insurance,
      insurer: r.state.insurer,
      policy_number: r.state.policy_number,
    },
  });
}

async function updateContact(body: Record<string, unknown>, deps: PatientInsuranceDeps, userId: string): Promise<Response> {
  const supabase = deps.supabase;
  const patientId = body.patient_id as string;

  // --- validate -------------------------------------------------------------
  let fullName: string | null | undefined;
  if (body.full_name !== undefined) {
    fullName = cleanPersonName(body.full_name);
    if (!fullName || fullName.length < 2 || (body.full_name as string).length > PERSON_NAME_MAX * 2) {
      return err(400, "invalid_full_name", "Escribe el nombre completo del titular (2 a 120 caracteres).");
    }
  }

  let phone: string | undefined;
  if (body.phone !== undefined) {
    if (typeof body.phone !== "string" || body.phone.length > 40) {
      return err(400, "invalid_phone", "Teléfono inválido. Usa 10 dígitos (México) o el formato internacional con +.");
    }
    phone = normalizeMxPhone(body.phone);
    if (!isValidNormalizedPhone(phone)) {
      return err(400, "invalid_phone", "Teléfono inválido. Usa 10 dígitos (México) o el formato internacional con +.");
    }
  }

  let appointmentId: string | null = null;
  let attended: string | null | undefined;
  if (body.appointment_id !== undefined && body.appointment_id !== null) {
    if (typeof body.appointment_id !== "string" || !UUID_RE.test(body.appointment_id)) {
      return err(400, "invalid_appointment_id", "Cita inválida.");
    }
    appointmentId = body.appointment_id;
    if (body.appointment_patient_name !== undefined) {
      const raw = body.appointment_patient_name;
      if (raw !== null && (typeof raw !== "string" || raw.length > PERSON_NAME_MAX * 2)) {
        return err(400, "invalid_patient_name", "El nombre de quien se atiende no es válido.");
      }
      attended = cleanPersonName(raw);
      if (attended !== null && attended.length < 2) {
        return err(400, "invalid_patient_name", "El nombre de quien se atiende no es válido.");
      }
    }
  }

  if (fullName === undefined && phone === undefined && attended === undefined) {
    return err(400, "nothing_to_update", "No hay cambios que guardar.");
  }

  // --- read current state ---------------------------------------------------
  const { data: current, error: readErr } = await supabase
    .from("patients")
    .select("id, full_name, phone")
    .eq("id", patientId)
    .maybeSingle();
  if (readErr) return err(500, "temporarily_unavailable", "No pudimos consultar al paciente. Intenta de nuevo.");
  const patient = current as { id: string; full_name: string | null; phone: string | null } | null;
  if (!patient) return err(404, "not_found", "No encontramos a ese paciente.");

  if (appointmentId) {
    const { data: appt } = await supabase
      .from("appointments")
      .select("id, patient_id")
      .eq("id", appointmentId)
      .eq("patient_id", patientId)
      .maybeSingle();
    if (!appt) return err(404, "appointment_not_found", "No encontramos esa cita de este paciente.");
  }

  const phoneChanged = phone !== undefined && phone !== patient.phone;
  if (phoneChanged) {
    const { data: owners, error: dupErr } = await supabase
      .from("patients")
      .select("id")
      .in("phone", mxPhoneLookupVariants(phone!))
      .neq("id", patientId)
      .limit(1);
    if (dupErr) return err(500, "temporarily_unavailable", "No pudimos validar el teléfono. Intenta de nuevo.");
    if ((owners as { id: string }[] | null)?.length) {
      return err(409, "phone_taken", "Ese teléfono ya pertenece a otro paciente. Búscalo por su número y edita ese registro.");
    }
  }

  // --- write ----------------------------------------------------------------
  const patch: Record<string, string> = {};
  const nameChanged = fullName !== undefined && fullName !== patient.full_name;
  if (nameChanged) patch.full_name = fullName!;
  if (phoneChanged) patch.phone = phone!;
  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await supabase.from("patients").update(patch).eq("id", patientId);
    if (upErr) {
      if ((upErr as { code?: string }).code === "23505") {
        return err(409, "phone_taken", "Ese teléfono ya pertenece a otro paciente. Búscalo por su número y edita ese registro.");
      }
      console.error("[admin-update-patient-insurance] contact update failed", upErr.message);
      return err(500, "temporarily_unavailable", "No pudimos guardar los datos. Intenta de nuevo.");
    }
    // Appointments that showed the old titular name were the titular's own.
    if (nameChanged && patient.full_name) {
      await supabase
        .from("appointments")
        .update({ patient_name: fullName })
        .eq("patient_id", patientId)
        .eq("patient_name", patient.full_name);
    }
  }

  let appointmentOut: { id: string; patient_name: string | null } | undefined;
  if (appointmentId && attended !== undefined) {
    const { error: apErr } = await supabase
      .from("appointments")
      .update({ patient_name: attended })
      .eq("id", appointmentId)
      .eq("patient_id", patientId);
    if (apErr) {
      console.error("[admin-update-patient-insurance] appointment name update failed", apErr.message);
      return err(500, "temporarily_unavailable", "Guardamos los datos del titular, pero no el nombre de la cita. Intenta de nuevo.");
    }
    appointmentOut = { id: appointmentId, patient_name: attended };
  }

  console.log(JSON.stringify({
    event: "patient_contact_updated",
    patient_id: patientId,
    by: userId,
    changed: [...Object.keys(patch), ...(appointmentOut ? ["appointment_patient_name"] : [])],
  }));
  await scheduleWhaapyContactSync(supabase, deps.whaapy, { patientId });

  return jsonResponse({
    patient: { id: patientId, full_name: patch.full_name ?? patient.full_name, phone: patch.phone ?? patient.phone },
    ...(appointmentOut ? { appointment: appointmentOut } : {}),
  });
}
