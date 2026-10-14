// Admin edits a patient's insurance from the appointment detail (FindMed
// decision a). Separate from index.ts so tests can inject the database and
// the authorization check.
//
// POST { patient_id, has_insurance: true | false | null, insurer?, policy_number? }
// → 200 { patient: { id, has_insurance, insurer, policy_number } } | 4xx { error, message }
//
// "replace" semantics: what the form sends is what stays (blank = empty).
// has_insurance null = "No capturado"; false = "Sin seguro" (clears insurer
// and policy).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { INSURER_MAX, POLICY_MAX, savePatientInsuranceById } from "../_shared/patient-insurance.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PatientInsuranceDeps {
  supabase: SupabaseClient;
  authorize: (req: Request) => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;
}

const optionalText = (v: unknown, max: number): string | null | false => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length > max * 2) return false;
  return v;
};

export async function handlePatientInsurance(req: Request, deps: PatientInsuranceDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed", message: "Método no permitido" }, 405);

  const auth = await deps.authorize(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.status === 403 ? "forbidden" : "unauthorized", message: "No tienes permiso para editar el seguro." }, auth.status);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json", message: "Cuerpo inválido" }, 400);
  }
  if (typeof body.patient_id !== "string" || !UUID_RE.test(body.patient_id)) {
    return jsonResponse({ error: "invalid_patient_id", message: "Paciente inválido." }, 400);
  }
  if (body.has_insurance !== true && body.has_insurance !== false && body.has_insurance !== null) {
    return jsonResponse({ error: "invalid_has_insurance", message: "Indica si tiene seguro, si no tiene o si no se ha capturado." }, 400);
  }
  const insurer = optionalText(body.insurer, INSURER_MAX);
  const policy = optionalText(body.policy_number, POLICY_MAX);
  if (insurer === false || policy === false) {
    return jsonResponse({ error: "invalid_text", message: "La aseguradora o la póliza no son válidas." }, 400);
  }

  const r = await savePatientInsuranceById(deps.supabase, body.patient_id, {
    hasInsurance: body.has_insurance,
    insurer,
    policyNumber: policy,
  }, "replace");
  if (!r.ok) return jsonResponse({ error: r.code, message: r.message_es }, r.code === "not_found" ? 404 : 500);
  if (!r.saved) return jsonResponse({ error: "not_saved", message: "No se pudo guardar." }, 500);

  console.log(JSON.stringify({ event: "patient_insurance_updated", patient_id: r.patient_id, by: auth.userId }));
  return jsonResponse({
    patient: {
      id: r.patient_id,
      has_insurance: r.state.has_insurance,
      insurer: r.state.insurer,
      policy_number: r.state.policy_number,
    },
  });
}
