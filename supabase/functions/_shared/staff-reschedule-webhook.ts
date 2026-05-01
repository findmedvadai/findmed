// Shared dispatcher for the `appointment.rescheduled_by_staff` event. Used by
// both `admin-reschedule-appointment` and `doctor-reschedule-appointment`.
//
// Why a shared helper: both EFs go through the same exact post-update flow
// (look up manage_url, build the same payload, fire one webhook). Keeping it
// inline in each EF made it easy to drift — see ERRORES.md entry on cancel
// webhook contract inconsistency.
//
// Why only ONE event (no `appointment.status_changed`): a staff reschedule
// does NOT change the appointment's status. The patient-side flow
// (`manage-reschedule`) is the one that emits `appointment.rescheduled`; this
// helper is for the staff-initiated path only.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateManageUrl } from "./manage-token.ts";
import { normalizeMxPhone } from "./phone.ts";

export interface StaffRescheduleInput {
  supabase: SupabaseClient;
  appointmentId: string;
  doctorId: string;
  doctorName: string | null;
  patientName: string | null;
  patientPhone: string | null;
  officeId: string | null;
  officeName: string | null;
  previousStartAt: string;
  previousEndAt: string;
  startAt: string;
  endAt: string;
  source: "admin" | "doctor_manual";
}

export async function dispatchStaffRescheduleWebhook(
  input: StaffRescheduleInput
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("[staff-reschedule-webhook] SUPABASE_URL/SERVICE_ROLE_KEY missing");
    return;
  }

  const manageUrl = await getOrCreateManageUrl({
    supabase: input.supabase,
    appointmentId: input.appointmentId,
    endAt: input.endAt,
    patientPhone: input.patientPhone ?? "",
  }).catch((err) => {
    console.error("[staff-reschedule-webhook] manage_url lookup failed:", err);
    return null;
  });

  const normalizedPhone = input.patientPhone
    ? normalizeMxPhone(input.patientPhone)
    : null;

  try {
    await fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        event_type: "appointment.rescheduled_by_staff",
        payload: {
          appointment_id: input.appointmentId,
          doctor_id: input.doctorId,
          doctor_name: input.doctorName,
          patient_name: input.patientName,
          patient_phone: normalizedPhone,
          office_id: input.officeId,
          office_name: input.officeName,
          previous_start_at: input.previousStartAt,
          previous_end_at: input.previousEndAt,
          start_at: input.startAt,
          end_at: input.endAt,
          manage_url: manageUrl,
          source: input.source,
          timestamp: new Date().toISOString(),
        },
      }),
    });
  } catch (err) {
    console.error("[staff-reschedule-webhook] dispatch-webhook failed:", err);
  }
}
