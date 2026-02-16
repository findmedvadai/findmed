

## Refinamientos Doctor + Linea de hora actual + Portal del Paciente

---

### 1. Eliminar drag-and-drop de la agenda del doctor

**Archivo:** `src/pages/doctor/Agenda.tsx`

Remover:
- Tipo `DragState` (lineas 77-86) y estados `drag`, `dragRef` (lineas 100-101)
- Funciones `snapMinutes`, `getDayIdxFromX`, `handleMouseDown` (lineas 199-232)
- `useEffect` completo del mouse move/up (lineas 234-314)
- Constante `SNAP_MINUTES` (linea 46)
- `onMouseDown` del evento renderizado (lineas 501-503)
- Clase `cursor-grab active:cursor-grabbing` del evento (linea 496)
- Renderizado del "ghost" de arrastre (lineas 520-544)
- Condicion `if (drag) return;` en el click de columna (linea 459)
- Condicion `if (isDragging) return null;` en eventos (lineas 481-482)
- Imports no utilizados: `useCallback`, `addMinutes`

La edicion y eliminacion de eventos Google se mantienen intactas (funcionan via el dialog de detalle + CreateEventDialog en modo edicion).

---

### 2. Nombre del doctor en el sidebar

**Archivo:** `src/components/layouts/DoctorLayout.tsx`

- Importar `useQuery` y `supabase`
- Usar `useAuth()` para obtener `doctorId`
- Hacer query a `doctors` para obtener `full_name` del doctor logueado
- Reemplazar el texto "Portal Doctor" por el nombre del doctor (ej: "Dr. Juan Perez")
- Mantener "FindMed" como titulo principal

---

### 3. Linea roja de hora actual

Agregar un indicador visual en tiempo real que muestre la hora actual como una linea roja horizontal con un circulo rojo en el extremo izquierdo. Solo se muestra en la columna del dia actual.

**Archivos a modificar:**
- `src/pages/doctor/Agenda.tsx`
- `src/pages/admin/Calendario.tsx`

**Logica:**
- Estado `currentTime` actualizado cada 60 segundos via `setInterval`
- Posicion vertical: `((hora - START_HOUR) * 60 + minutos) / 60 * HOUR_HEIGHT`
- Solo renderizar si la columna corresponde al dia de hoy y la hora esta dentro del rango visible (7 AM - 9 PM)
- Estilo: linea roja de 2px con circulo rojo de 10px en el borde izquierdo, `z-index: 30`

---

### 4. Portal del Paciente

#### Flujo corregido

El flujo real es:
1. El webhook de triage (`triage-webhook`) recibe: `doctor_id`, `patient_name`, `patient_phone`, `symptoms`
2. El webhook genera un token de 32 caracteres y crea una `reservation_session`
3. El webhook construye la URL: `/reserva?token=TOKEN`
4. El paciente abre la URL

**Lo que ve el paciente (correccion):**
- Nombre del doctor asignado
- Direccion del doctor (campo `address` de la tabla `doctors`)
- Calendario para elegir dia y horario disponible
- El paciente NO ve los sintomas

#### 4a. Ruta `/reserva` - Seleccion de horario

**Archivo nuevo:** `src/pages/patient/Reserva.tsx`

Pantalla con:
- Header con nombre del doctor y su direccion
- Selector de fecha (calendario tipo date picker)
- Lista de horarios disponibles para la fecha seleccionada
- Al seleccionar horario, confirmacion y creacion de la cita

**Backend function nueva:** `reserve-validate`
- Recibe `token`
- Valida contra `reservation_sessions` (no expirado, no usado)
- Retorna: `doctor_name`, `doctor_address`, `patient_name`, `doctor_id`, `session_id`, `patient_id`, `symptoms` (para uso interno, no se muestra)

**Backend function nueva:** `reserve-slots`
- Recibe `doctor_id` y `date`
- Consulta `doctor_weekly_availability` y `doctor_schedule_settings` para duracion de citas
- Consulta `doctor_date_overrides` para ver si el dia esta bloqueado
- Consulta `appointments` existentes para ese dia
- Consulta Google Calendar del doctor para eventos que bloquean horarios
- Retorna array de slots disponibles (ej: `["09:00", "09:30", "10:00", ...]`)

**Backend function nueva:** `reserve-create`
- Recibe `session_id`, `slot_start` (hora elegida)
- Calcula `end_at` basandose en `appointment_duration_minutes` del doctor
- Crea el registro en `appointments` con `status = 'scheduled'`
- Crea el evento en Google Calendar del doctor (via refresh token)
- Marca la `reservation_session` como `used_at = now()`
- Genera un `appointment_manage_token` con expiracion de 12 horas
- Retorna la URL de gestion (`/gestionar?token=...`) y detalles de la cita

#### 4b. Ruta `/gestionar` - Gestion de cita

**Archivo nuevo:** `src/pages/patient/Gestionar.tsx`

Muestra:
- Nombre del doctor
- Fecha y hora de la cita
- Opcion de cancelar (con confirmacion)

**Backend function nueva:** `manage-validate`
- Recibe `token`, valida contra `appointment_manage_tokens` (no expirado)
- Retorna detalles de la cita (doctor, fecha, hora, status)

**Backend function nueva:** `manage-cancel`
- Recibe `token`
- Actualiza el status de la cita a `cancelled` con `cancel_reason = 'patient'`
- Elimina el evento de Google Calendar del doctor

#### 4c. Rutas en App.tsx

Agregar rutas publicas (sin ProtectedRoute):
- `/reserva` -> `Reserva`
- `/gestionar` -> `Gestionar`

---

### Resumen de archivos

| Archivo | Accion |
|---|---|
| `src/pages/doctor/Agenda.tsx` | Modificar (quitar drag, agregar linea roja) |
| `src/pages/admin/Calendario.tsx` | Modificar (agregar linea roja) |
| `src/components/layouts/DoctorLayout.tsx` | Modificar (nombre del doctor) |
| `src/pages/patient/Reserva.tsx` | Crear |
| `src/pages/patient/Gestionar.tsx` | Crear |
| `src/App.tsx` | Modificar (agregar rutas publicas) |
| `supabase/functions/reserve-validate/index.ts` | Crear |
| `supabase/functions/reserve-slots/index.ts` | Crear |
| `supabase/functions/reserve-create/index.ts` | Crear |
| `supabase/functions/manage-validate/index.ts` | Crear |
| `supabase/functions/manage-cancel/index.ts` | Crear |

### Notas tecnicas

- `reserve-slots` usa el `google_refresh_token_ref` del doctor para consultar Google Calendar y evitar conflictos con eventos existentes
- Las funciones del portal del paciente usan `verify_jwt = false` y validan por token, no por JWT
- La linea roja usa `setInterval` de 60 segundos; se limpia con cleanup del `useEffect`
- El token de reserva es de un solo uso (12h vigencia); el token de gestion permite multiples usos dentro de 12h
- `reserve-create` sincroniza con Google Calendar del doctor automaticamente

