

## Plan: Add `manage_url` to all `appointment.status_changed` webhook payloads

### Problem
The `appointment.status_changed` webhook event is dispatched from 7 different edge functions, but none of them include the `manage_url` in the payload. This is needed for n8n to send the patient a link to manage their appointment.

### Approach
For each function, look up (or reuse) the existing manage token for the appointment and include `manage_url` in the `appointment.status_changed` payload.

### Functions to update

| Function | Has manage token available? | Action needed |
|---|---|---|
| **reserve-create** | Yes (`manageToken` already generated) | Add `manage_url` to status_changed payload |
| **confirm-appointment** | No | Query `appointment_manage_tokens` for the appointment, build URL |
| **manage-cancel** | Yes (`token` from request body) | Build URL from existing token |
| **manage-reschedule** | Yes (`manageToken.token`) | Add `manage_url` to status_changed payload |
| **cancel-by-doctor** | Yes (`rescheduleToken` just created) | Add `manage_url: rescheduleUrl` to status_changed payload |
| **update-appointment-status** | No | Query `appointment_manage_tokens` for the appointment, build URL |
| **auto-cancel-unconfirmed** | Yes (`rescheduleToken` just created) | Add `manage_url: rescheduleUrl` to status_changed payload |

### Payload change
Each `appointment.status_changed` dispatch will add one field:
```json
{
  "appointment_id": "...",
  "patient_phone": "...",
  "patient_name": "...",
  "previous_status": "...",
  "new_status": "...",
  "start_at": "...",
  "timestamp": "...",
  "manage_url": "https://...app/gestionar?token=ABC123"  // NEW
}
```

For **confirm-appointment** and **update-appointment-status** (where no token is in scope), a query to `appointment_manage_tokens` will fetch the latest valid token for the appointment.

### Files modified (7 edge functions)
- `supabase/functions/reserve-create/index.ts`
- `supabase/functions/confirm-appointment/index.ts`
- `supabase/functions/manage-cancel/index.ts`
- `supabase/functions/manage-reschedule/index.ts`
- `supabase/functions/cancel-by-doctor/index.ts`
- `supabase/functions/update-appointment-status/index.ts`
- `supabase/functions/auto-cancel-unconfirmed/index.ts`

All 7 functions will be redeployed after the changes.

