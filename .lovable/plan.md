

## Plan actualizado: 3 correcciones + 1 nuevo webhook

### 1. Corregir timezone en reserve-slots (slots del mismo dia)

**Problema**: En `reserve-slots/index.ts` lineas 219-224, el filtro de "slots pasados para hoy" usa `now.getHours()` que devuelve hora UTC en Deno, no hora de Mexico City. Ademas, la comparacion de "hoy" usa `now.toISOString().split("T")[0]` que tambien es fecha UTC.

**Solucion**: Usar `Intl.DateTimeFormat` con `timeZone: "America/Mexico_City"` para:
- Obtener la fecha de "hoy" en Mexico City (para comparar con `date`)
- Obtener la hora actual en Mexico City (para filtrar slots pasados)
- Aplicar `min_confirm_hours_before` del doctor: solo mostrar slots donde `slotStart >= nowMinutes + (minConfirmHours * 60)`

**Cambios en `reserve-slots/index.ts`**:
- Leer `min_confirm_hours_before` del query de settings (ya lee `appointment_duration_minutes` y `timezone`)
- Reemplazar lineas 219-224 con logica que usa timezone de Mexico City
- Devolver flag `within_48h: boolean` en la respuesta cuando la diferencia entre ahora y el slot es menor a 48h

```text
// Pseudocodigo del filtro para hoy:
const nowMx = Intl.DateTimeFormat con America/Mexico_City
const todayMxStr = fecha local Mexico City
const nowMinutes = hora:minuto local Mexico City en minutos
const minConfirmHours = settings.min_confirm_hours_before ?? 24

if (date === todayMxStr) {
  const cutoff = nowMinutes + (minConfirmHours * 60)
  if (slotStartMinutes < cutoff) return false  // slot no disponible
}
```

---

### 2. Auto-confirmar citas dentro de 48h (pero permitir reagendar/cancelar)

**Cambios en `reserve-create/index.ts`**:
- Calcular si la cita cae dentro de 48h desde ahora
- Si es asi, crear con `status: "confirmed"` en vez de `"scheduled"`
- Incluir `auto_confirmed: true` en la respuesta

**Cambios en `manage-reschedule/index.ts`**:
- Misma logica de auto-confirmacion: si la nueva cita cae dentro de 48h, crearla como `confirmed`

**Sin cambios en la UI de Gestionar**: las citas auto-confirmadas se pueden reagendar y cancelar igual que cualquier otra cita. La unica diferencia es que se crean directamente como "confirmed".

---

### 3. Permitir reagendar citas canceladas

**Cambio en `manage-reschedule/index.ts`** lineas 82-87:
- Eliminar el bloqueo `if (oldAppt.status === "cancelled") return error`
- Condicionar la cancelacion de la cita vieja: solo cancelar si `oldAppt.status !== "cancelled"`
- Condicionar el borrado del evento Google Calendar: solo si la cita vieja no estaba ya cancelada

```text
// En lugar de bloquear:
if (oldAppt.status !== "cancelled") {
  // Cancelar cita vieja + borrar Google event
}
// Siempre crear nueva cita
```

---

### 4. Nuevo webhook: Recordatorio del dia de la cita (8:00am Mexico City)

**Nueva Edge Function: `send-day-of-reminders/index.ts`**

Funcion que se ejecuta via cron job diario a las 8:00am hora Mexico City (14:00 UTC). Busca citas confirmadas (`status = "confirmed"`) cuyo `start_at` sea el dia de hoy en zona horaria Mexico City.

Para cada cita encontrada:
- Busca o genera un `manage_token` valido
- Dispara webhook `appointment.reminder_day_of` con:
  - `patient_name`
  - `patient_phone`
  - `doctor_name`
  - `start_at`
  - `manage_url` (link para reagendar o cancelar)

**Configuracion**:
- Agregar `[functions.send-day-of-reminders] verify_jwt = false` en `config.toml`
- Configurar cron job para ejecutar diariamente a las 14:00 UTC (8:00am Mexico City)

---

### Resumen de archivos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/reserve-slots/index.ts` | Usar timezone Mexico City para filtro de "hoy"; aplicar `min_confirm_hours_before`; devolver `within_48h` |
| `supabase/functions/reserve-create/index.ts` | Auto-confirmar citas dentro de 48h (`status: "confirmed"`) |
| `supabase/functions/manage-reschedule/index.ts` | Permitir reagendar citas canceladas; auto-confirmar si dentro de 48h |
| `supabase/functions/send-day-of-reminders/index.ts` | NUEVO: recordatorio diario a las 8am para citas confirmadas del dia |
| `supabase/config.toml` | Agregar entry para `send-day-of-reminders` |
| `src/pages/admin/Webhooks.tsx` | Agregar `appointment.reminder_day_of` al catalogo de eventos y payload examples |

### Pruebas a realizar

1. Agendar cita para hoy con doctor cuyo `min_confirm_hours_before` = 1h: verificar que aparecen horarios y que la cita se crea como `confirmed`
2. Reagendar cita cancelada por doctor desde link de gestion: verificar que funciona
3. Probar `send-day-of-reminders` llamandola manualmente y verificar que el webhook se dispara con los datos correctos
4. Probar flujo completo de auto-cancelacion y confirmar que el webhook se dispara correctamente

