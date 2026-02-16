
## Correcciones del Portal del Paciente

Se identificaron 4 bugs principales y una funcionalidad faltante. Aqui esta el diagnostico y las correcciones.

---

### Bug 1: Slots no excluyen eventos de Google Calendar

**Causa raiz:** En `reserve-slots`, los eventos de Google Calendar vienen con timezone (ej: `"2026-02-17T09:00:00-06:00"`). Al hacer `new Date(evt.start).getHours()`, Deno (que corre en UTC) devuelve la hora UTC, no la hora local. Un evento a las 9:00 AM Mexico = 15:00 UTC, asi que `getHours()` retorna 15 en vez de 9, y la comparacion contra el slot "09:00" (minuto 540) falla.

**Solucion:** Extraer la hora local directamente del string `dateTime` del evento de Google (parsear los primeros caracteres `HH:MM` del campo `dateTime`) en lugar de usar `getHours()` del objeto Date.

**Archivo:** `supabase/functions/reserve-slots/index.ts` (lineas 187-195)

---

### Bug 2: Evento no se crea en Google Calendar

**Causa raiz:** En `reserve-create`, `startAt` es `"2026-02-17T16:00:00"` (sin timezone) pero `endAt` usa `endDate.toISOString()` que produce `"2026-02-17T17:00:00.000Z"` (con Z = UTC). Al enviarlo a Google Calendar:
- `start.dateTime = "2026-02-17T16:00:00"` con `timeZone: "America/Mexico_City"` = 16:00 Mexico
- `end.dateTime = "2026-02-17T17:00:00.000Z"` = 17:00 UTC = 11:00 Mexico

Google interpreta que el evento empieza a las 16:00 y termina a las 11:00 (antes del inicio), lo cual probablemente causa un error silencioso.

**Solucion:** Formatear `endAt` de la misma manera que `startAt`, como string plano sin `Z`:

```text
// En vez de:
const endAt = endDate.toISOString();

// Usar:
const endHH = String(endDate.getUTCHours()).padStart(2, "0");
const endMM = String(endDate.getUTCMinutes()).padStart(2, "0");
const endAt = `${date}T${endHH}:${endMM}:00`;
```

Y pasar `timeZone: "America/Mexico_City"` tambien en el objeto `end` del evento de Google Calendar.

**Archivo:** `supabase/functions/reserve-create/index.ts` (lineas 93-97, 155-156)

---

### Bug 3: Horario incorrecto en pantalla de confirmacion (16:00 - 11:00)

**Causa raiz:** Mismo problema del Bug 2. El frontend recibe `start_at = "2026-02-17T16:00:00"` (sin Z, el browser lo interpreta como hora local = 16:00) y `end_at = "2026-02-17T17:00:00.000Z"` (con Z, el browser lo convierte a hora local Mexico = 11:00). Por eso muestra "16:00 - 11:00".

**Solucion:** Se resuelve automaticamente con el fix del Bug 2 (formatear `endAt` igual que `startAt`).

---

### Bug 4: Pagina Gestionar - informacion incorrecta

Varios sub-problemas:

**4a. Horario incorrecto (10:00 - 11:00 en vez de 16:00 - 17:00):**
La columna `start_at` en la BD es `timestamp with time zone` y almacena `2026-02-17 16:00:00+00` (UTC). Cuando el frontend recibe esto como ISO string con Z, lo convierte a hora local Mexico (-6h) = 10:00. Necesitamos que `manage-validate` retorne las horas en el timezone del doctor, no en UTC.

**Solucion:** En `manage-validate`, consultar el timezone del doctor y formatear `start_at`/`end_at` como strings sin timezone (hora local del doctor).

**4b. Estado dice "Activa" en vez de "Reservada":**
El status en la BD es `scheduled` pero la UI muestra "Activa".

**Solucion:** En `Gestionar.tsx`, mapear los estados: `scheduled` -> "Reservada", `confirmed` -> "Confirmada", `cancelled` -> "Cancelada", `completed` -> "Completada".

**4c. No aparece el nombre del paciente:**
`manage-validate` no retorna el nombre del paciente.

**Solucion:** En `manage-validate`, hacer join con `patients` via `appointment.patient_id` y retornar `patient_name`.

**4d. Falta funcionalidad de reagendar:**
No existe ni la UI ni el backend para que el paciente pueda reagendar su cita.

**Solucion:** 
- Crear nueva edge function `manage-reschedule` que:
  1. Valida el token
  2. Cancela la cita actual (y elimina el evento de Google Calendar)
  3. Crea una nueva cita en el horario elegido (y crea nuevo evento en Google Calendar)
  4. Actualiza el manage token para apuntar a la nueva cita
- En `Gestionar.tsx`, agregar boton "Reagendar cita" que muestra el mismo selector de fecha/hora del portal de reserva, reutilizando `reserve-slots` para obtener horarios disponibles.

**Archivos a modificar:**
- `supabase/functions/manage-validate/index.ts` - agregar patient_name, formatear horarios
- `src/pages/patient/Gestionar.tsx` - mapear estados, mostrar paciente, agregar reagendamiento
- `supabase/functions/manage-reschedule/index.ts` - crear nueva funcion

---

### Resumen de cambios

| Archivo | Cambio |
|---|---|
| `supabase/functions/reserve-slots/index.ts` | Parsear hora local de Google events directamente del string dateTime |
| `supabase/functions/reserve-create/index.ts` | Formatear endAt sin Z, pasar timeZone en start y end para Google Calendar |
| `supabase/functions/manage-validate/index.ts` | Retornar patient_name, formatear horarios en timezone del doctor |
| `supabase/functions/manage-reschedule/index.ts` | Crear (cancela cita actual + crea nueva + sync Google Calendar) |
| `src/pages/patient/Gestionar.tsx` | Mostrar nombre paciente, mapear estados en espanol, agregar flujo de reagendamiento |
| `supabase/config.toml` | Agregar entrada para manage-reschedule con verify_jwt = false |
