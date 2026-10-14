// Shared bits of the reminder crons (send-appointment-reminders,
// send-day-of-reminders). Each run claims an appointment by setting its
// marker (UPDATE … WHERE marker IS NULL) before dispatching the event.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ReminderMarker = "reminder_48h_sent_at" | "reminder_day_of_sent_at";

/**
 * Undo a claim whose dispatch failed, so a later run retries it. Only clears
 * the marker this run wrote (same timestamp): a newer claim is left alone.
 * Retrying is safe because domain_outbox dedupes the same event for the same
 * appointment and start time, so a dispatch that did land is not sent twice.
 */
export async function releaseReminderClaim(
  supabase: SupabaseClient,
  appointmentId: string,
  marker: ReminderMarker,
  claimedAt: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("appointments")
    .update({ [marker]: null })
    .eq("id", appointmentId)
    .eq(marker, claimedAt)
    .select("id");
  if (error) {
    console.error(`[reminders] could not release ${marker} for ${appointmentId}:`, error);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}
