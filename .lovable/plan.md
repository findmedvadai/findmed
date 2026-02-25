

## Plan: Webhook 48h + Notificaciones de notas + Filtros del Inbox Admin

### 1. Agregar `min_confirm_hours_before` al webhook de Recordatorio 48h

**Archivo**: `supabase/functions/send-appointment-reminders/index.ts`

- Consultar `doctor_schedule_settings` para obtener `min_confirm_hours_before` del doctor de cada cita
- Agregar el campo `min_confirm_hours_before` al payload del evento `appointment.reminder_48h`

```typescript
// Dentro del loop, antes del dispatch:
const { data: settings } = await supabase
  .from("doctor_schedule_settings")
  .select("min_confirm_hours_before")
  .eq("doctor_id", appt.doctor_id)
  .maybeSingle();

const minConfirmHours = settings?.min_confirm_hours_before ?? 24;

// En el payload:
min_confirm_hours_before: minConfirmHours,
```

---

### 2. Corregir notificaciones de notas del doctor al admin

**Problema raiz**: La tabla `notifications` no tiene politica RLS para INSERT. El codigo en `PorCompletar.tsx` intenta insertar una notificacion desde el cliente pero RLS lo bloquea silenciosamente.

**Solucion - Migracion SQL**:
```sql
CREATE POLICY "Doctor can insert admin notifications"
  ON public.notifications
  FOR INSERT
  WITH CHECK (
    recipient_role IN ('admin', 'superadmin')
    AND doctor_id = get_doctor_id_for_user(auth.uid())
  );
```

**Archivo**: `src/pages/doctor/PorCompletar.tsx`

Mejorar el body de la notificacion para incluir las notas y la fecha de la cita:

```typescript
body: `Dr. ${doctorData?.full_name ?? "Doctor"} completo notas para ${patient?.full_name ?? "Paciente"} (${format(parseISO(appointment.start_at), "d MMM yyyy", { locale: es })})\n\nNotas: ${notes.trim()}`,
```

---

### 3. Nuevos filtros del Inbox del Admin: por doctor y por especialidad

Actualmente el inbox filtra por tipo de notificacion. Se reemplazara por dos filtros: **Doctor** y **Especialidad**.

**Archivo**: `src/pages/admin/Inbox.tsx`

Cambios:

- Eliminar el estado `typeFilter` y las constantes `FILTER_OPTIONS`
- Agregar dos estados: `doctorFilter` (string, default `"all"`) y `specialtyFilter` (string, default `"all"`)
- Cargar lista de doctores con query: `supabase.from("doctors").select("id, full_name, doctor_specialties(specialty_id)")`
- Cargar lista de especialidades con query: `supabase.from("specialties").select("id, name").eq("is_active", true)`
- Ampliar el query de notificaciones para traer la especialidad del doctor: `select("*, doctors(full_name, doctor_specialties(specialty_id))")`
- Aplicar filtro por `doctor_id` directamente en el query de notificaciones cuando se selecciona un doctor
- Aplicar filtro por especialidad en el cliente: si se selecciona una especialidad, solo mostrar notificaciones cuyo doctor tenga esa especialidad
- Reemplazar el Select actual por dos Select en la barra de filtros:
  - Select "Doctor" con opcion "Todos" + lista de doctores
  - Select "Especialidad" con opcion "Todas" + lista de especialidades

La UI de las tarjetas (iconos, badges, mark as read, etc.) se mantiene exactamente igual.

