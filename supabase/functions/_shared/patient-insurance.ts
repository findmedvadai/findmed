// Patient insurance (FindMed decision a, 14-oct-2026): whether the patient has
// major-medical insurance, the insurer and the policy number, stored on
// public.patients. Written by:
//   * the MCP tools save_patient_insurance and create_booking_link (agent, "merge":
//     what the patient didn't mention is kept), and
//   * admin-update-patient-insurance (admin, "replace": the form is the truth).
//
// Identity follows the rest of the MCP: the contact's phone, normalized with
// normalizeMxPhone and looked up with mxPhoneLookupVariants. A patient row is
// only CREATED when we also have the patient's name (same pattern as
// create_booking_link); with just a phone nothing is created, so the agent
// can't leave nameless "ghost" patients behind.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidNormalizedPhone, mxPhoneLookupVariants, normalizeMxPhone } from "./phone.ts";

export const INSURER_MAX = 80;
export const POLICY_MAX = 40;

export interface InsuranceInput {
  /** true = has insurance, false = "Sin seguro", null = not captured (admin reset). */
  hasInsurance: boolean | null;
  insurer?: string | null;
  policyNumber?: string | null;
}

export interface InsuranceState {
  has_insurance: boolean | null;
  insurer: string | null;
  policy_number: string | null;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export function cleanInsurer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = collapse(raw).slice(0, INSURER_MAX).trim();
  return v.length > 0 ? v : null;
}

/** Policy numbers keep letters, digits and the usual separators; no spaces inside. */
export function cleanPolicyNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = collapse(raw).replace(/[^0-9A-Za-zÑñ\-/.]/g, "").slice(0, POLICY_MAX);
  return v.length > 0 ? v : null;
}

/**
 * Columns to write. "merge" (agent): a missing insurer/policy keeps the stored
 * one, except that a different insurer drops the old policy (it belonged to
 * the other company). "replace" (admin): exactly what the form says.
 * has_insurance false or null always clears insurer and policy.
 */
export function insurancePatch(
  current: InsuranceState | null,
  input: InsuranceInput,
  mode: "merge" | "replace",
  now = new Date(),
): InsuranceState & { insurance_updated_at: string } {
  const stamp = now.toISOString();
  if (input.hasInsurance !== true) {
    return { has_insurance: input.hasInsurance, insurer: null, policy_number: null, insurance_updated_at: stamp };
  }
  const insurer = cleanInsurer(input.insurer);
  const policy = cleanPolicyNumber(input.policyNumber);
  if (mode === "replace") {
    return { has_insurance: true, insurer, policy_number: policy, insurance_updated_at: stamp };
  }
  const keep = current?.has_insurance === true ? current : null;
  const sameInsurer = !insurer || !keep?.insurer || keep.insurer.toLowerCase() === insurer.toLowerCase();
  return {
    has_insurance: true,
    insurer: insurer ?? keep?.insurer ?? null,
    policy_number: policy ?? (sameInsurer ? keep?.policy_number ?? null : null),
    insurance_updated_at: stamp,
  };
}

export type SaveInsuranceResult =
  | { ok: true; saved: true; patient_id: string; created: boolean; state: InsuranceState }
  | { ok: true; saved: false; reason: "patient_not_registered" }
  | { ok: false; code: "invalid_phone" | "not_found" | "temporarily_unavailable"; message_es: string };

const STATE_COLUMNS = "id, has_insurance, insurer, policy_number";

/** Updates the insurance of a known patient (admin form, or after a booking link). */
export async function savePatientInsuranceById(
  supabase: SupabaseClient,
  patientId: string,
  input: InsuranceInput,
  mode: "merge" | "replace",
): Promise<SaveInsuranceResult> {
  const { data: current, error: readErr } = await supabase
    .from("patients")
    .select(STATE_COLUMNS)
    .eq("id", patientId)
    .maybeSingle();
  if (readErr) return { ok: false, code: "temporarily_unavailable", message_es: "No pude consultar al paciente en este momento." };
  if (!current) return { ok: false, code: "not_found", message_es: "No encontré a ese paciente." };
  const patch = insurancePatch(current as InsuranceState, input, mode);
  const { error } = await supabase.from("patients").update(patch).eq("id", patientId);
  if (error) {
    console.error("[patient-insurance] update failed", error.message);
    return { ok: false, code: "temporarily_unavailable", message_es: "No pude guardar el seguro en este momento." };
  }
  return {
    ok: true,
    saved: true,
    patient_id: patientId,
    created: false,
    state: { has_insurance: patch.has_insurance, insurer: patch.insurer, policy_number: patch.policy_number },
  };
}

/**
 * Agent path: finds the patient by the contact's phone and merges the
 * insurance. Creates the patient only when `patientName` is given.
 */
export async function savePatientInsuranceByPhone(
  supabase: SupabaseClient,
  input: InsuranceInput & { phone: string; patientName?: string | null },
): Promise<SaveInsuranceResult> {
  const canonical = normalizeMxPhone(input.phone);
  if (!isValidNormalizedPhone(canonical)) {
    return { ok: false, code: "invalid_phone", message_es: "No pude identificar el número de este contacto." };
  }
  const variants = mxPhoneLookupVariants(canonical);
  const findExisting = async () => {
    const { data, error } = await supabase
      .from("patients")
      .select("id")
      .in("phone", variants)
      .order("created_at", { ascending: true })
      .limit(1);
    return { id: (data as { id: string }[] | null)?.[0]?.id ?? null, error };
  };

  const existing = await findExisting();
  if (existing.error) return { ok: false, code: "temporarily_unavailable", message_es: "No pude consultar al paciente en este momento." };
  if (existing.id) return savePatientInsuranceById(supabase, existing.id, input, "merge");

  const name = input.patientName?.replace(/\s+/g, " ").trim() ?? "";
  if (name.length < 2) return { ok: true, saved: false, reason: "patient_not_registered" };

  const patch = insurancePatch(null, input, "merge");
  const { data: created, error } = await supabase
    .from("patients")
    .insert({ full_name: name.slice(0, 120), phone: canonical, ...patch })
    .select("id")
    .single();
  if (error || !created) {
    // Created meanwhile by another flow (patients.phone is unique): update it.
    if ((error as { code?: string } | null)?.code === "23505") {
      const raced = await findExisting();
      if (raced.id) return savePatientInsuranceById(supabase, raced.id, input, "merge");
    }
    console.error("[patient-insurance] insert failed", error?.message);
    return { ok: false, code: "temporarily_unavailable", message_es: "No pude guardar el seguro en este momento." };
  }
  return {
    ok: true,
    saved: true,
    patient_id: (created as { id: string }).id,
    created: true,
    state: { has_insurance: patch.has_insurance, insurer: patch.insurer, policy_number: patch.policy_number },
  };
}
