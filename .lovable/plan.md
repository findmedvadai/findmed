

## Plan: Integrar Outlook Calendar junto a Google Calendar

### Alcance del cambio

La integración con Outlook sigue exactamente el mismo patrón que Google Calendar: OAuth para conectar la cuenta, selección de calendario, y sincronización bidireccional (crear, actualizar y eliminar eventos). Un doctor podrá tener **una sola** conexión activa (Google **o** Outlook, no ambas simultáneamente), con la opción de desconectar una y conectar la otra.

### Requisitos previos (credenciales)

El admin necesita registrar una aplicación en Microsoft Entra (Azure AD) con permisos de `Calendars.ReadWrite`. Se necesitarán dos secrets nuevos:
- `OUTLOOK_CLIENT_ID`
- `OUTLOOK_CLIENT_SECRET`

### 1. Migración de base de datos

Agregar 3 columnas a la tabla `doctors`:

```sql
ALTER TABLE public.doctors
  ADD COLUMN outlook_refresh_token_ref text,
  ADD COLUMN outlook_calendar_id text,
  ADD COLUMN outlook_calendar_connected boolean NOT NULL DEFAULT false;
```

Agregar columna al `appointments` para el event ID de Outlook:

```sql
ALTER TABLE public.appointments
  ADD COLUMN outlook_event_id text;
```

### 2. Nuevas Edge Functions (6 funciones, espejo de las de Google)

| Función | Propósito |
|---|---|
| `outlook-calendar-auth` | Genera URL de OAuth de Microsoft |
| `outlook-calendar-callback` | Recibe el code, intercambia por refresh_token, guarda en DB |
| `outlook-calendar-list` | Lista calendarios del usuario via Microsoft Graph |
| `outlook-calendar-events` | Obtiene eventos de un rango de fechas |
| `outlook-calendar-create-event` | Crea evento en Outlook |
| `outlook-calendar-delete-event` | Elimina evento de Outlook |
| `outlook-calendar-update-event` | Actualiza evento en Outlook |

Todas usan Microsoft Graph API (`https://graph.microsoft.com/v1.0/me/calendars/...`). El token refresh se intercambia en `https://login.microsoftonline.com/common/oauth2/v2.0/token`.

### 3. Actualizar config.toml

Agregar `verify_jwt = false` para las funciones de callback y auth de Outlook.

### 4. Actualizar Edge Functions existentes que sincronizan calendario

Las siguientes funciones tienen lógica inline de Google Calendar y necesitan agregar la lógica equivalente para Outlook (verificar `outlook_calendar_connected` y usar Microsoft Graph):

- **`reserve-create`** — al crear cita, crear evento en Outlook si conectado
- **`cancel-by-doctor`** — al cancelar, eliminar evento de Outlook
- **`manage-cancel`** — cancelación por paciente, eliminar evento de Outlook
- **`manage-reschedule`** — reagendar, eliminar evento viejo y crear nuevo en Outlook

La lógica es: si `outlook_calendar_connected`, usar Outlook; si `google_calendar_connected`, usar Google. No ambos a la vez.

### 5. Frontend — Página de Configuración del doctor

Modificar `src/pages/doctor/Configuracion.tsx` para mostrar **dos tarjetas** de calendario:
- Google Calendar (existente)
- Outlook Calendar (nueva, mismo patrón: conectar, seleccionar calendario, desconectar)

Al conectar una, si la otra ya está conectada, desconectarla automáticamente (o mostrar advertencia).

### 6. Frontend — Página de éxito de Outlook

Crear `src/pages/OutlookCalendarSuccess.tsx` (copia de `GoogleCalendarSuccess.tsx` adaptada) y agregar la ruta en el router.

### 7. Frontend — Agenda

Modificar `src/pages/doctor/Agenda.tsx` para también hacer fetch de eventos de Outlook (query a `outlook-calendar-events`) cuando el doctor tenga Outlook conectado, y mezclarlos en el calendario igual que los de Google.

### 8. Frontend — CreateEventDialog

Modificar `src/components/doctor/CreateEventDialog.tsx` para detectar si el doctor usa Outlook y llamar las funciones correspondientes (`outlook-calendar-create-event` / `outlook-calendar-update-event`).

### Archivos nuevos (8)
- 7 edge functions en `supabase/functions/outlook-calendar-*/index.ts`
- `src/pages/OutlookCalendarSuccess.tsx`

### Archivos modificados (9)
- `supabase/config.toml`
- `supabase/functions/reserve-create/index.ts`
- `supabase/functions/cancel-by-doctor/index.ts`
- `supabase/functions/manage-cancel/index.ts`
- `supabase/functions/manage-reschedule/index.ts`
- `src/pages/doctor/Configuracion.tsx`
- `src/pages/doctor/Agenda.tsx`
- `src/components/doctor/CreateEventDialog.tsx`
- `src/App.tsx` (nueva ruta)

### Secrets necesarios
Se pedirán al admin: `OUTLOOK_CLIENT_ID` y `OUTLOOK_CLIENT_SECRET`.

