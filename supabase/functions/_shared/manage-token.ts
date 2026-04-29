// Generation + insertion of `appointment_manage_tokens` rows. These tokens
// power the patient-facing /gestionar?token=… page (cancel, reschedule).
//
// All write paths that create an appointment — patient self-booking
// (reserve-create), admin manual creation, and the recurring reminders that
// rotate tokens — should use the same token format so the n8n WhatsApp flow
// can build the same /gestionar URL regardless of who created the row.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 32;

export function generateManageToken(): string {
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return token;
}

interface CreateManageTokenInput {
  supabase: SupabaseClient;
  appointmentId: string;
  /** ISO 8601 string. Convention: token expires when the appointment ends. */
  expiresAt: string;
  patientPhone: string;
}

export interface ManageTokenResult {
  token: string;
  /** Full /gestionar URL. APP_URL env var or the lovable fallback. */
  manageUrl: string;
}

/**
 * Return the manage URL for an appointment using an existing token, or create
 * a new one if none exists. Used by cancel flows that don't generate their own
 * token (admin-cancel, doctor-office-delete).
 */
export async function getOrCreateManageUrl(input: {
  supabase: SupabaseClient;
  appointmentId: string;
  endAt: string;
  patientPhone: string;
}): Promise<string> {
  const baseUrl = Deno.env.get("APP_URL") || "https://findmed.lovable.app";
  const { data: existing } = await input.supabase
    .from("appointment_manage_tokens")
    .select("token")
    .eq("appointment_id", input.appointmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.token) {
    return `${baseUrl}/gestionar?token=${existing.token}`;
  }
  const result = await createManageToken({
    supabase: input.supabase,
    appointmentId: input.appointmentId,
    expiresAt: input.endAt,
    patientPhone: input.patientPhone,
  });
  return result.manageUrl;
}

/**
 * Insert a new manage token for the given appointment and return both the raw
 * token and the patient-facing /gestionar URL. Failure is fatal — caller decides
 * whether to surface or swallow.
 */
export async function createManageToken(input: CreateManageTokenInput): Promise<ManageTokenResult> {
  const token = generateManageToken();
  const { error } = await input.supabase.from("appointment_manage_tokens").insert({
    appointment_id: input.appointmentId,
    token,
    expires_at: input.expiresAt,
    patient_phone: input.patientPhone,
  });
  if (error) throw error;

  const baseUrl = Deno.env.get("APP_URL") || "https://findmed.lovable.app";
  return { token, manageUrl: `${baseUrl}/gestionar?token=${token}` };
}
