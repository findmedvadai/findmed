
## Plan completo unificado: Correcciones + Nuevos webhooks + UI de detalle/edición de webhooks

Este plan combina las tres partes: (1) correcciones de flujos existentes, (2) cuatro nuevos webhooks con sus edge functions, y (3) la mejora de la interfaz de webhooks en el portal admin.

---

### Parte 1 — Correcciones de flujos existentes

#### Fix 1: Contador de citas — solo citas futuras pendientes

Archivo: `src/pages/doctor/Agenda.tsx`

El `summary` useMemo en la línea 211 cuenta todas las citas de la semana sin importar si ya pasaron. Se actualiza para filtrar solo aquellas cuyo `end_at` sea posterior a la hora actual en Mexico City:

```
// Antes:
total: appointments.length,
confirmed: appointments.filter((a) => a.status === "confirmed").length,
scheduled: appointments.filter((a) => a.status === "scheduled").length,

// Después:
const nowUtc = new Date();
const pending = appointments.filter((a) => parseISO(a.end_at) > nowUtc);
total: pending.length,
confirmed: pending.filter((a) => a.status === "confirmed").length,
scheduled: pending.filter((a) => a.status === "scheduled").length,
```

El contador ya se actualiza cada minuto porque `currentTime` actualiza el estado, lo que fuerza el re-render. Hay que asegurarse de que `summary` dependa también de `currentTime`.

#### Fix 2: "Por Completar" — incluir citas confirmadas cuya hora de fin ya pasó

Archivo: `src/pages/doctor/PorCompletar.tsx`

La query actual filtra solo `status = "completed"`. Se cambia para incluir también citas `confirmed` cuyo `end_at` ya pasó (y sin notas médicas). Se usa una query `or` en Supabase:

```typescript
.or(
  'and(status.eq.completed,doctor_notes.is.null),' +
  'and(status.eq.confirmed,end_at.lt.' + new Date().toISOString() + ',doctor_notes.is.null)'
)
```

Al guardar notas en estas citas `confirmed`, también se actualiza `status` a `completed` (ya lo hace el código actual en la línea 112: `status: "completed"`). La notificación al admin ya existe en `PorCompletar.tsx`.

#### Fix 3: Notificación admin al guardar notas desde AppointmentDetailDialog

Archivo: `src/components/doctor/AppointmentDetailDialog.tsx`

El `notesMutation.onSuccess` actualmente solo invalida queries. Se agrega la inserción de la notificación al admin (igual que en `PorCompletar.tsx`):

```typescript
onSuccess: async () => {
  // Notificación admin
  const { data: doctorData } = await supabase.from("doctors").select("full_name").eq("id", doctorId).single();
  const { data: patientData } = await supabase.from("patients").select("full_name").eq("id", ...).single();
  await supabase.from("notifications").insert({
    doctor_id: doctorId,
    appointment_id: item.id,
    recipient_role: "admin",
    type: "appointment_completed",
    title: "Cita completada con notas",
    body: `Dr. ${doctorData?.full_name} completó notas para ${patientData?.full_name}`,
  });
  toast.success("Notas guardadas");
  invalidate();
  setEditingNotes(false);
}
```

#### Fix 4: Verificación del flujo "paciente confirma → cita verde"

Revisión del código existente confirma que el flujo funciona:
- `confirm-appointment` edge function actualiza `status = "confirmed"`
- La agenda del doctor colorea `confirmed` en verde (`bg-confirmed`)
- Solo se necesita verificar que `manage-cancel` ya incluye `patient_phone` en el webhook (actualmente NO lo incluye). Se agrega al payload.

---

### Parte 2 — Cuatro nuevos webhooks

#### Webhook 1: Doctor cancela cita — nueva edge function `cancel-by-doctor`

Nueva función: `supabase/functions/cancel-by-doctor/index.ts`

El `AppointmentDetailDialog.tsx` actualmente llama directo a `supabase.from("appointments").update({status: "cancelled"})`. Se cambia para llamar a esta nueva edge function que:

1. Recibe `appointment_id` y el JWT del doctor (autenticado)
2. Verifica que la cita pertenece al doctor
3. Actualiza `status = "cancelled", cancel_reason = "doctor"`
4. Busca `patient_phone` y `patient_name` del paciente
5. Genera un nuevo `manage_token` para el link de reagendamiento (12h de vigencia)
6. Inserta notificación para el doctor (historial de su propia acción)
7. Llama a `dispatch-webhook` con evento `appointment.cancelled_by_doctor`:

```json
{
  "appointment_id": "...",
  "patient_phone": "+521234567890",
  "patient_name": "Karla Gamez",
  "doctor_name": "Dr. ...",
  "start_at": "2026-02-18T17:00:00+00:00",
  "cancel_reason": "doctor",
  "message": "Tu cita fue cancelada por el doctor",
  "reschedule_url": "https://.../gestionar?token=..."
}
```

Se actualiza `EVENT_GROUPS` en `Webhooks.tsx` para incluir `appointment.cancelled_by_doctor`.

Se actualiza `AppointmentDetailDialog.tsx` para que `cancelMutation` llame a la edge function en lugar de hacer el update directo al cliente.

#### Webhook 2: Recordatorio 48h antes + confirmación desde página de gestión

**2a. Nueva edge function `send-appointment-reminders`** (cron job):

Lógica:
- Busca citas con `status = "scheduled"` cuyo `start_at` esté entre 47h y 49h en el futuro
- Para cada una, obtiene un `manage_token` válido existente o genera uno nuevo
- Llama a `dispatch-webhook` con evento `appointment.reminder_48h`:

```json
{
  "appointment_id": "...",
  "patient_phone": "+521234567890",
  "patient_name": "...",
  "doctor_name": "Dr. ...",
  "start_at": "...",
  "manage_url": "https://.../gestionar?token=...",
  "message": "Tu cita es en 48 horas. Puedes confirmar, cancelar o reagendar desde el link."
}
```

El cron se configura para ejecutarse cada hora con `pg_cron` (SQL que el admin ejecuta en Cloud View).

**2b. Confirmación desde `/gestionar`** — `src/pages/patient/Gestionar.tsx`:

Se agrega un botón "Confirmar cita" que solo aparece cuando `status === "scheduled"`. Al hacer click llama a la edge function `confirm-appointment` existente (usando el token para obtener el `appointment_id`).

Nueva UI en Gestionar.tsx:
```
┌──────────────────────────────────────┐
│  ✅ Confirmar cita  (verde, prominente)│
│  📅 Reagendar cita                    │
│  ❌ Cancelar cita   (destructivo)     │
└──────────────────────────────────────┘
```

Se adapta `confirm-appointment` para aceptar un `manage_token` (además del `appointment_id` actual), para que no se requiera autenticación.

#### Webhook 3: Auto-cancelación por no confirmación — `auto-cancel-unconfirmed`

Nueva función: `supabase/functions/auto-cancel-unconfirmed/index.ts`

Lógica:
- Busca citas con `status = "scheduled"`
- Para cada doctor, lee `min_confirm_hours_before` de `doctor_schedule_settings`
- Si `start_at - min_confirm_hours_before horas < now()`, la cita no fue confirmada a tiempo
- Actualiza `status = "cancelled", cancel_reason = "no_confirmation"`
- Inserta notificación al doctor ("Cita auto-cancelada: {paciente} no confirmó a tiempo")
- Llama a `dispatch-webhook` con evento `appointment.auto_cancelled`:

```json
{
  "appointment_id": "...",
  "patient_phone": "+521234567890",
  "patient_name": "...",
  "doctor_name": "Dr. ...",
  "start_at": "...",
  "cancel_reason": "no_confirmation",
  "message": "Tu cita fue cancelada automáticamente porque no fue confirmada a tiempo",
  "reschedule_url": "https://.../gestionar?token=..."
}
```

Se necesita añadir `no_confirmation` al enum `cancel_reason` en la base de datos (migración SQL).

El cron se configura para ejecutarse cada hora.

#### Webhook 4: Cambio de estado en cada transición — `appointment.status_changed`

Se agrega la llamada a `dispatch-webhook` con evento `appointment.status_changed` en cada función que modifica el estado:

| Función | Transición |
|---|---|
| `reserve-create` | `null → scheduled` |
| `confirm-appointment` | `scheduled → confirmed` |
| `manage-cancel` | `any → cancelled (patient)` |
| `cancel-by-doctor` (nueva) | `any → cancelled (doctor)` |
| `auto-cancel-unconfirmed` (nueva) | `scheduled → cancelled (no_confirmation)` |
| `manage-reschedule` | `any → scheduled (rescheduled)` |

Payload estándar:
```json
{
  "appointment_id": "...",
  "patient_phone": "+521234567890",
  "patient_name": "...",
  "previous_status": "scheduled",
  "new_status": "confirmed",
  "start_at": "...",
  "timestamp": "..."
}
```

`manage-cancel` actualmente no incluye `patient_phone` en su webhook — se agrega.

---

### Parte 3 — Mejora de la UI de Webhooks en el portal admin

Archivo: `src/pages/admin/Webhooks.tsx`

#### 3.1 Nuevos eventos en EVENT_GROUPS

Se agregan los nuevos eventos al catálogo:

```typescript
const EVENT_GROUPS = [
  {
    label: "Citas",
    events: [
      { id: "appointment.created", label: "Cita creada" },
      { id: "appointment.confirmed", label: "Cita confirmada" },
      { id: "appointment.cancelled", label: "Cita cancelada (paciente)" },
      { id: "appointment.cancelled_by_doctor", label: "Cita cancelada por doctor" },
      { id: "appointment.auto_cancelled", label: "Cita auto-cancelada" },
      { id: "appointment.rescheduled", label: "Cita reagendada" },
      { id: "appointment.completed", label: "Cita completada" },
      { id: "appointment.reminder_48h", label: "Recordatorio 48h" },
      { id: "appointment.status_changed", label: "Cambio de estado" },
    ],
  },
  {
    label: "Pacientes",
    events: [
      { id: "patient.created", label: "Paciente creado" },
    ],
  },
];
```

#### 3.2 Tarjetas de webhook — botón de ver/editar

Cada tarjeta tendrá un botón de lápiz (ícono `Pencil`) que abre el panel de detalle/edición. El botón de eliminar se mantiene.

#### 3.3 Dialog de detalle/edición con dos pestañas

Se agrega un `Dialog` con `Tabs` que se abre al hacer click en el botón de editar:

**Tab "Configuración":**
- Campo: Nombre (Input editable)
- Campo: URL endpoint (Input editable)
- Campo: Descripción (Textarea editable)
- Toggle: Activo/Inactivo
- Checklist de eventos (misma UI que al crear)
- Fecha de creación (texto, solo lectura)
- Botón "Guardar cambios" → llama a `updateMut`
- Botón "Regenerar secret" → abre `AlertDialog` de confirmación

**Tab "Payload de ejemplo":**
- Para cada evento suscrito por el webhook, muestra un bloque `<pre>` con JSON de ejemplo colapsable
- Botón de copiar en cada bloque
- Sección de headers HTTP que se envían:
  - `Content-Type: application/json`
  - `X-FindMed-Signature: <hmac-sha256 del body>`
  - `X-FindMed-Event: <event_type>`

Ejemplos de payload por evento:

| Evento | Campos en `data` |
|---|---|
| `appointment.created` | appointment_id, patient_name, patient_phone, doctor_name, start_at, end_at, symptoms, manage_url |
| `appointment.confirmed` | appointment_id, patient_name, patient_phone, doctor_name, start_at, confirmed_at |
| `appointment.cancelled` | appointment_id, patient_name, patient_phone, doctor_name, start_at, cancel_reason: "patient" |
| `appointment.cancelled_by_doctor` | appointment_id, patient_name, patient_phone, doctor_name, start_at, cancel_reason: "doctor", message, reschedule_url |
| `appointment.auto_cancelled` | appointment_id, patient_name, patient_phone, doctor_name, start_at, cancel_reason: "no_confirmation", message, reschedule_url |
| `appointment.rescheduled` | appointment_id, patient_name, patient_phone, doctor_name, new_start_at, old_start_at, manage_url |
| `appointment.completed` | appointment_id, patient_name, patient_phone, doctor_name, completed_at, doctor_notes |
| `appointment.reminder_48h` | appointment_id, patient_name, patient_phone, doctor_name, start_at, manage_url, message |
| `appointment.status_changed` | appointment_id, patient_name, patient_phone, previous_status, new_status, start_at, timestamp |
| `patient.created` | patient_id, patient_name, patient_phone, created_at |

#### 3.4 Mutation de edición — `updateMut`

Nueva función que ejecuta:
```typescript
supabase.from("webhooks").update({ name, url, description, events }).eq("id", selectedWebhook.id)
```

Validaciones: nombre y URL requeridos, al menos un evento seleccionado.

#### 3.5 Regenerar secret

Al hacer click en "Regenerar secret":
1. `AlertDialog` confirma: "El secret anterior dejará de funcionar inmediatamente"
2. Si confirma: genera nuevo secret con `generateSecret()`, hace `update({ secret })`, muestra el mismo modal "Copia este secret ahora"

---

### Resumen de todos los archivos modificados / creados

| Archivo | Acción | Descripción |
|---|---|---|
| `src/pages/doctor/Agenda.tsx` | Editar | Summary filtra `end_at > now()` y depende de `currentTime` |
| `src/pages/doctor/PorCompletar.tsx` | Editar | Query incluye citas `confirmed` con `end_at` pasado |
| `src/components/doctor/AppointmentDetailDialog.tsx` | Editar | cancelMutation llama edge fn; notesMutation inserta notif admin |
| `src/pages/patient/Gestionar.tsx` | Editar | Botón "Confirmar cita" para estado `scheduled` |
| `src/pages/admin/Webhooks.tsx` | Editar | Nuevos eventos en catálogo, botón editar en tarjetas, Dialog con Tabs de config + payload |
| `supabase/functions/cancel-by-doctor/index.ts` | Nuevo | Cancela cita por doctor + webhook `appointment.cancelled_by_doctor` |
| `supabase/functions/send-appointment-reminders/index.ts` | Nuevo | Cron 48h: webhook `appointment.reminder_48h` |
| `supabase/functions/auto-cancel-unconfirmed/index.ts` | Nuevo | Cron: auto-cancela + webhook `appointment.auto_cancelled` |
| `supabase/functions/confirm-appointment/index.ts` | Editar | Acepta `manage_token`; agrega `patient_phone` + `appointment.status_changed` |
| `supabase/functions/manage-cancel/index.ts` | Editar | Agrega `patient_phone` al payload; agrega `appointment.status_changed` |
| `supabase/functions/manage-reschedule/index.ts` | Editar | Agrega `patient_phone`; agrega `appointment.status_changed` |
| `supabase/functions/reserve-create/index.ts` | Editar | Agrega `appointment.status_changed` al crear |
| `supabase/config.toml` | Editar | Registrar `cancel-by-doctor`, `send-appointment-reminders`, `auto-cancel-unconfirmed` con `verify_jwt = false` |
| Migración SQL | Nuevo | Agrega `no_confirmation` al enum `cancel_reason` |

### Nota sobre el cron de pg_cron

Los jobs de `send-appointment-reminders` y `auto-cancel-unconfirmed` requieren ejecutar SQL en la base de datos para configurar el cron. Se entregarán las instrucciones exactas para que el admin las ejecute desde Cloud View > Run SQL una sola vez.
