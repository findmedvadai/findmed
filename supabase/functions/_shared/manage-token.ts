// Generation + insertion of `appointment_manage_tokens` rows. These tokens
// power the patient-facing /gestionar?token=… page (cancel, reschedule).
//
// All write paths that create an appointment — patient self-booking
// (reserve-create), admin manual creation, and the recurring reminders that
// rotate tokens — should use the same token format so the n8n WhatsApp flow
// can build the same /gestionar URL regardless of who created the row.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { appBaseUrl } from "./events.ts";

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 32;

// Cryptographically secure token over TOKEN_ALPHABET. Math.random is not a
// CSPRNG (its state can be recovered from outputs), so tokens that grant
// access to a patient's appointment must use crypto.getRandomValues. Bytes
// >= the largest multiple of the alphabet size are rejected to avoid modulo bias.
export function generateSecureToken(alphabet = TOKEN_ALPHABET, length = TOKEN_LENGTH): string {
  const limit = 256 - (256 % alphabet.length);
  let token = "";
  while (token.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit) token += alphabet[b % alphabet.length];
      if (token.length === length) break;
    }
  }
  return token;
}

export function generateManageToken(): string {
  return generateSecureToken();
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
  /** Full /gestionar URL built from APP_URL (see events.ts appBaseUrl). */
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
  const baseUrl = appBaseUrl();
  // Only reuse a token that is still valid; an expired one would send the
  // patient a dead link.
  const { data: existing } = await input.supabase
    .from("appointment_manage_tokens")
    .select("token")
    .eq("appointment_id", input.appointmentId)
    .gt("expires_at", new Date().toISOString())
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
 * Moves every manage token of `fromAppointmentId` to `toAppointmentId` and
 * makes them expire at `expiresAt` (the new appointment's end). Returns how
 * many tokens moved, or null if the update failed.
 *
 * manage-reschedule uses it as the claim of a patient reschedule: the UPDATE
 * is a compare-and-swap on appointment_id, so of two concurrent reschedules of
 * the same appointment (double click, two tabs) only the first moves the
 * tokens; the second gets 0 and must roll back its new appointment. Moving all
 * tokens (not only the one used) also keeps older links — e.g. the one the
 * auto-cancel message carried — from rescheduling the old appointment again.
 */
export async function repointManageTokens(
  supabase: SupabaseClient,
  fromAppointmentId: string,
  toAppointmentId: string,
  expiresAt: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("appointment_manage_tokens")
    .update({ appointment_id: toAppointmentId, expires_at: expiresAt })
    .eq("appointment_id", fromAppointmentId)
    .select("id");
  if (error) {
    console.error("[manage-token] repoint failed:", error);
    return null; // unknown: the caller must not assume it lost a race
  }
  return Array.isArray(data) ? data.length : 0;
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

  const baseUrl = appBaseUrl();
  return { token, manageUrl: `${baseUrl}/gestionar?token=${token}` };
}
