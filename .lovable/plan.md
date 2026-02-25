## Plan: Webhook 48h + Notificaciones de notas + Filtros del Inbox Admin

### ✅ 1. Agregar `min_confirm_hours_before` al webhook de Recordatorio 48h

**Archivo**: `supabase/functions/send-appointment-reminders/index.ts`

- Se consulta `doctor_schedule_settings` para obtener `min_confirm_hours_before` del doctor
- Se agrega el campo al payload del evento `appointment.reminder_48h`

---

### ✅ 2. Corregir notificaciones de notas del doctor al admin

- Se agregó política RLS `INSERT` en `notifications` para doctores
- Se mejoró el body para incluir notas médicas y fecha de la cita

---

### ✅ 3. Nuevos filtros del Inbox del Admin: por doctor y por especialidad

- Se reemplazó el filtro por tipo de notificación por dos filtros: Doctor y Especialidad
- Las tarjetas mantienen la misma UI (iconos, badges, mark as read)
- El body de notificaciones de notas ahora muestra `whitespace-pre-line` para respetar saltos de línea
