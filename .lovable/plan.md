

## Crear eventos desde la agenda del doctor + sincronizacion bidireccional con Google Calendar

### Contexto actual

- La agenda del doctor muestra eventos de Google Calendar (lectura) y citas de la plataforma
- No existe forma de crear eventos/citas desde la agenda
- No existe una edge function para crear eventos en Google Calendar
- Las citas creadas en la plataforma no se sincronizan a Google Calendar

### Cambios necesarios

---

### 1. Nueva Edge Function: `google-calendar-create-event`

Crea un evento en el Google Calendar del doctor. Recibe titulo, fecha/hora inicio y fin, y descripcion opcional. Usa el refresh token del doctor para obtener un access token y llama a la API de Google Calendar.

**Archivo:** `supabase/functions/google-calendar-create-event/index.ts`

**Logica:**
- Autentica al doctor via JWT (mismo patron que `google-calendar-events`)
- Obtiene `google_refresh_token_ref` y `google_calendar_id` del doctor
- Refresca el access token de Google
- Hace POST a `https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events`
- Retorna el `event_id` y `htmlLink` del evento creado

**Request body:**
```text
{
  "summary": "Titulo del evento",
  "description": "Descripcion opcional",
  "start_at": "2026-02-20T09:00:00-06:00",
  "end_at": "2026-02-20T10:00:00-06:00"
}
```

---

### 2. Dialog para crear evento: `CreateEventDialog`

**Archivo:** `src/components/doctor/CreateEventDialog.tsx`

Un dialog modal con formulario para crear un evento rapido:
- Campo: Titulo (requerido)
- Campo: Descripcion (opcional)
- Campos: Fecha, Hora inicio, Hora fin (pre-llenados si el doctor hizo click en un slot especifico)
- Boton "Crear evento" que llama a la edge function

Al guardar exitosamente:
- Invalida queries de `google-calendar-events` para refrescar la agenda
- Muestra toast de exito
- Cierra el dialog

---

### 3. Modificar la agenda para permitir crear eventos

**Archivo:** `src/pages/doctor/Agenda.tsx`

Cambios:
- Agregar boton "+" en el header para abrir el CreateEventDialog
- Hacer click en un slot vacio de la cuadricula para abrir el dialog pre-llenado con la fecha/hora correspondiente
- Estado `createEventDate` para controlar el dialog y pre-llenar valores

---

### 4. Configuracion de la edge function

**Archivo:** `supabase/config.toml` (se actualiza automaticamente)

Registrar `google-calendar-create-event` con `verify_jwt = false` (la validacion se hace manualmente en el codigo, mismo patron que las demas funciones de Google Calendar).

---

### Resumen de archivos

| Archivo | Accion |
|---|---|
| `supabase/functions/google-calendar-create-event/index.ts` | Crear (nueva edge function) |
| `src/components/doctor/CreateEventDialog.tsx` | Crear (nuevo componente) |
| `src/pages/doctor/Agenda.tsx` | Modificar (agregar boton + y click en slot) |

### Notas tecnicas

- No se necesitan cambios en la base de datos. Los eventos creados desde la agenda son eventos de Google Calendar puros (tipo "google" en la UI). Cuando el portal del paciente cree citas, esas si se guardaran en la tabla `appointments` Y en Google Calendar.
- El dialog pre-llena la fecha/hora basandose en donde el doctor haga click en la cuadricula, calculando la hora a partir de la posicion Y del click.
- Se reutiliza el patron de autenticacion existente (decode JWT manual + service role) de las demas edge functions de Google Calendar.

