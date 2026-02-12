

# FindMed Scheduling Platform — Phase 1: Core Booking Flow

## Branding & Design System
- Apply FindMed colors: **Azul #123D74** (headers, structure), **Rosa #E30050** (CTA buttons), **Gris #8493A2** (secondary text), **Gris claro #EDEEF1** (backgrounds/borders), **Blanco #FFFFFF** (base)
- Professional, medical, minimalist style with rounded buttons and clear visual hierarchy
- All dates/times in **America/Mexico_City** timezone

---

## Database Schema (Phase 1 Tables)
Set up the core Supabase tables with RLS policies:

- **users** — with role enum (superadmin, admin, doctor) and doctor_id FK
- **user_roles** — separate roles table for security
- **cities**, **zones**, **specialties** — catalog tables
- **doctors** — with Google Calendar fields (connected, refresh_token_ref, calendar_id)
- **doctor_specialties** — many-to-many relationship
- **doctor_schedule_settings** — duration, confirmation threshold, timezone
- **doctor_weekly_availability** — weekday ranges with enable/disable
- **doctor_date_overrides** — specific blocked dates
- **patients** — phone in E.164 format
- **reservation_sessions** — booking tokens (12h expiry, single-use)
- **appointments** — full appointment lifecycle with status enum
- **appointment_manage_tokens** — manage tokens (12h expiry, multi-use)
- **notifications** — in-app notifications for doctor/admin

RLS policies ensuring patients never access tables directly, doctors only see their own data, and admins have full operational access.

---

## Edge Functions (Phase 1)

### 1. Triage Webhook (`POST /triage-webhook`)
- Receives doctor_id, patient info, symptoms from n8n
- Normalizes phone to E.164 (+52 default)
- Upserts patient, creates reservation_session with 32-char token
- Returns reserve_url with 12h expiry

### 2. Get Availability (`GET /reserve`)
- Validates token (exists, not expired, not used, phone match)
- Checks doctor is active and Google Calendar connected
- Calculates available slots for next 30 days using weekly availability, date overrides, and Google Calendar conflicts
- Returns calendar days with availability

### 3. Create Appointment (`POST /appointments/create`)
- Re-validates everything (anti-race condition with DB lock)
- Creates Google Calendar event
- Creates appointment (status=scheduled)
- Marks reservation token as used
- Generates manage_token
- Fires webhook to n8n

### 4. Cancel Appointment (`POST /appointments/cancel`)
- Validates manage_token + phone
- Deletes Google Calendar event
- Updates status to cancelled (reason=patient)
- Idempotent (already cancelled = success)

### 5. Reschedule Appointment (`POST /appointments/reschedule`)
- Validates manage_token + phone
- Re-validates new slot availability
- Deletes old Google Calendar event, creates new one
- Updates same appointment with new times, resets to scheduled
- Issues new manage_token

### 6. Confirm Appointment (`POST /appointments/confirm`)
- Called by n8n when patient confirms via WhatsApp
- Changes scheduled → confirmed (idempotent)

---

## Patient Pages (No Login Required)

### `/reserva` — Booking Page
- Validates token via Edge Function on load
- Shows doctor name, specialties, address, city/zone
- Monthly calendar showing all days (unavailable days grayed out)
- On day selection: shows available time slots
- On slot confirmation: creates appointment with loading state, prevents double-click
- Success screen with friendly confirmation message
- Error states with friendly messages (expired, used, slot taken, doctor disconnected)

### `/gestionar` — Manage Appointment Page
- Validates manage_token on load
- Shows appointment details (doctor, date, time)
- Two options: **Cancel** or **Reschedule**
- Cancel: confirmation dialog → cancels → success message
- Reschedule: shows calendar/slots picker → creates new booking → success with new manage_url
- Friendly error messages for expired tokens

---

## Doctor Dashboard (Login Required)

### Onboarding — Google Calendar Connection
- OAuth flow via Edge Function to connect Google Calendar
- After connection: dropdown to select which calendar to use
- Saves calendar_id to doctor profile

### `/doctor/agenda` — Calendar View
- Visual calendar showing appointments with color coding:
  - 🟡 Yellow = Scheduled
  - 🟢 Green = Confirmed
- Based on platform appointments

### `/doctor/configuracion` — Settings
- **Profile**: phone, address, city, zone, specialties
- **Appointment duration**: minutes input
- **Confirmation threshold**: hours before appointment
- **Weekly availability**: checkboxes per weekday with time range picker
- **Blocked dates**: calendar picker for specific dates

### `/doctor/por-completar` — Complete Appointments
- List of confirmed appointments where start_at has passed
- Red badge indicator for pending items
- Form to add doctor_notes and mark as completed
- Ability to edit notes after completion

### `/doctor/inbox` — Notifications
- Tabs for scheduled and cancelled appointment notifications

---

## Admin Dashboard (Login Required)

### `/admin/calendario` — Global Calendar
- Overview of all appointments across all doctors

### `/admin/reservas` — Reservations Table
- Full table with all required columns: patient name, phone, symptoms, doctor, specialties, status, date/time, city, zone, cancel reason, doctor notes
- Filters: date range, status, doctor, specialty, city, zone, cancel reason
- Search by patient name
- Pagination

### `/admin/doctores` — Doctor Management
- CRUD for doctors
- Shows Google Calendar connection status (connected/disconnected)
- "Enable doctor profile" to create login credentials

### `/admin/catalogos` — Catalog Management
- CRUD for cities, zones, specialties
- Alphabetically sorted dropdowns

### `/admin/inbox` — Completed Appointments
- Notifications for completed appointments
- Click to see detail card with doctor_notes

---

## Authentication & Roles
- Supabase Auth for Doctor, Admin, Superadmin login
- Role-based route protection
- Doctors can only see/edit their own data
- Admins have full operational access
- Patient phone is hidden from doctors

---

## Phase 2 (Future)
These will be built in subsequent phases:
- Superadmin webhook management (CRUD, test send, logs)
- Superadmin API key management (create/rotate/revoke)
- Auto-cancel cron job (every 5 min for unconfirmed appointments)
- Google Calendar polling job (every 5-10 min to detect doctor deletions)
- Webhook dispatch system to n8n
- Complete appointment endpoint for doctor

