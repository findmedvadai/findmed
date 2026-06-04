# CLAUDE.md — FindMed

Guía de contexto para Claude Code al trabajar en este repositorio. Todo lo aquí documentado está basado en el código real del proyecto.

---

## 1. Descripción del proyecto

**FindMed** es una plataforma SaaS de gestión de citas médicas orientada al mercado mexicano (zona horaria por defecto `America/Mexico_City`, UI en español, normalización de teléfonos a `+52`).

- **Para quién**: clínicas, administradores y doctores que necesitan agendar, confirmar, cancelar y dar seguimiento a consultas médicas; y pacientes que reservan/gestionan sus citas mediante links únicos (sin crear cuenta).
- **Problema que resuelve**: automatiza el ciclo completo de una cita (triaje → reserva → confirmación → recordatorios → post‑consulta → reporte) integrándose con el calendario del doctor (Google/Outlook) y con canales externos (WhatsApp vía n8n u otro orquestador que consuma webhooks firmados y llame a los endpoints de API key).

---

## 2. Stack técnico

| Capa | Tecnología |
|---|---|
| Bundler / dev server | [Vite 5](vite.config.ts) con `@vitejs/plugin-react-swc` |
| Lenguaje | TypeScript (configuración permisiva: `strictNullChecks: false`, `noImplicitAny: false`) — ver [tsconfig.json](tsconfig.json) |
| UI framework | React 18 + React Router 6 |
| Librería de componentes | [shadcn/ui](components.json) (estilo `default`, baseColor `slate`, CSS vars) montada sobre Radix UI |
| Estilos | Tailwind CSS 3 con tema HSL en CSS variables (ver [src/index.css](src/index.css) y [tailwind.config.ts](tailwind.config.ts)) |
| Data fetching / caché | `@tanstack/react-query` v5 |
| Formularios / validación | `react-hook-form` + `zod` + `@hookform/resolvers` |
| Fechas | `date-fns` + `date-fns-tz` (timezone `America/Mexico_City`) |
| Iconos | `lucide-react` |
| Render de markdown | `react-markdown` + `remark-gfm` (solo en páginas legales públicas) sobre `@tailwindcss/typography` (`prose`) |
| Notificaciones UI | `sonner` (toasts) + `@/components/ui/toaster` (shadcn) |
| Backend | [Supabase](src/integrations/supabase/client.ts): Postgres + Auth + Row Level Security + Edge Functions (Deno) + Realtime |
| Auth | Supabase Auth con email/password, persistencia en `localStorage` |
| Hosting | **Vercel** (producción). El proyecto migró de Lovable al proyecto Supabase `jyzvdowflblxmlahlupo`. El `APP_URL` en producción es la URL de Vercel; en desarrollo local es `http://localhost:5173`. Actualizar la env var `APP_URL` en Supabase al hacer cada deploy. |
| Testing | `vitest` + `@testing-library/react` + `jsdom` |
| APIs externas | Google Calendar API, Microsoft Graph (Outlook Calendar), webhooks firmados con HMAC‑SHA‑256 para WhatsApp/n8n |

---

## 3. Estructura del proyecto

```
findmed/
├── src/
│   ├── App.tsx                     # Rutas principales + providers globales
│   ├── main.tsx                    # Entry point (createRoot)
│   ├── index.css                   # Tokens de diseño (CSS variables HSL)
│   ├── content/
│   │   └── legal/                  # Documentos legales en markdown (privacidad.md, terminos.md) — source of truth, NO modificar el texto
│   ├── components/
│   │   ├── NavLink.tsx             # Wrapper de NavLink de react-router con activeClassName
│   │   ├── Footer.tsx              # Footer global público con links a /privacidad y /terminos
│   │   ├── LegalDocument.tsx       # Renderer de docs legales (react-markdown + remark-gfm) para rutas públicas
│   │   ├── ProtectedRoute.tsx      # HOC: gate por rol, redirige a login o al home del rol
│   │   ├── admin/                  # Diálogos específicos del admin (AppointmentDetailDialog, PasswordGate, PostConsultationDetailDialog, SendReportModal)
│   │   ├── doctor/                 # Diálogos del doctor (AppointmentDetailDialog, CreateEventDialog, DayHeaderPopover, DoctorProfileCard)
│   │   ├── layouts/                # AdminLayout, DoctorLayout (sidebar + Outlet)
│   │   └── ui/                     # Componentes shadcn/ui generados (accordion, button, dialog, table, sidebar, …)
│   ├── hooks/
│   │   ├── useAuth.tsx             # AuthProvider + useAuth() — expone user, session, role, doctorId, signOut
│   │   ├── use-mobile.tsx
│   │   └── use-toast.ts
│   ├── integrations/supabase/
│   │   ├── client.ts               # Cliente tipado, lee VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
│   │   └── types.ts                # Tipos generados automáticamente (Database, enums, tables)
│   ├── lib/
│   │   ├── utils.ts                # cn() = clsx + tailwind-merge
│   │   └── specialty-colors.ts     # Paleta de colores para especialidades
│   ├── pages/
│   │   ├── Index.tsx               # Redirige a /login
│   │   ├── Login.tsx
│   │   ├── NotFound.tsx
│   │   ├── GoogleCalendarSuccess.tsx / OutlookCalendarSuccess.tsx  # Popups de OAuth
│   │   ├── admin/                  # Calendario, Reservas, Doctores, Catalogos, Inbox, Webhooks, ApiKeys
│   │   ├── doctor/                 # Agenda, Configuracion, PorCompletar, DoctorInbox
│   │   ├── patient/                # Reserva, Gestionar (acceso por token, sin login)
│   │   └── legal/                  # Privacidad, Terminos (rutas públicas /privacidad y /terminos, sin login)
│   └── test/                       # Setup de vitest
├── supabase/
│   ├── functions/                  # Edge Functions (Deno) — ver sección 7
│   └── migrations/                 # SQL migrations versionadas por timestamp
├── public/                         # Estáticos (favicon, og-image, robots.txt)
├── .env                            # Variables VITE_* (cliente)
├── components.json                 # Config shadcn/ui
├── tailwind.config.ts
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── vite.config.ts
└── package.json
```

Alias de import: `@/*` → `./src/*` (definido en [tsconfig.json](tsconfig.json) y [vite.config.ts](vite.config.ts)).

---

## 4. Arquitectura

### Frontend ↔ Supabase

- El cliente Supabase se instancia una sola vez en [src/integrations/supabase/client.ts](src/integrations/supabase/client.ts) y se importa en todo el frontend como `import { supabase } from "@/integrations/supabase/client"`.
- La sesión se gestiona con [useAuth](src/hooks/useAuth.tsx): escucha `supabase.auth.onAuthStateChange`, persiste en `localStorage`, y al login consulta la tabla `public.users` para resolver `role` y `doctor_id`.
- La protección de rutas es por rol en [App.tsx](src/App.tsx) usando [ProtectedRoute](src/components/ProtectedRoute.tsx), que redirige según el rol:
  - `admin` / `superadmin` → `/admin/calendario`
  - `doctor` → `/doctor/agenda`

### Tipos de acceso a datos

1. **Usuarios autenticados (admin / doctor)**: usan el cliente Supabase con el JWT del usuario; **todas las consultas pasan por RLS**. Funciones SQL `has_role`, `is_admin_or_superadmin` y `get_doctor_id_for_user` son `SECURITY DEFINER` y manejan la autorización.
2. **Pacientes (sin login)**: acceden vía Edge Functions públicas usando tokens temporales (`reservation_sessions.token` o `appointment_manage_tokens.token`) que llegan por URL (`/reserva?token=…`, `/gestionar?token=…`). La Edge Function valida el token, usa el service role key y devuelve sólo los campos necesarios.
3. **Sistemas externos (n8n / WhatsApp bot)**: autenticación con API keys con prefijo `fm_` (validadas por SHA‑256 contra `api_keys.key_hash`). Endpoints: `triage-webhook`, `update-appointment-status`, `search-doctors`, etc.
4. **Rutas públicas estáticas (sin login ni token)**: `/privacidad` y `/terminos` renderizan documentos legales (`src/content/legal/*.md`) requeridos para la verificación OAuth de Google/Microsoft. No tocan la base de datos. Están fuera de `ProtectedRoute` en [App.tsx](src/App.tsx). Un `Footer` global ([src/components/Footer.tsx](src/components/Footer.tsx)) enlaza a ambas desde la landing (`/login`) y desde las propias páginas legales.

### Realtime

Los layouts se suscriben a `postgres_changes` en la tabla `notifications` vía `supabase.channel(...)` para refrescar el badge de sin leer del Inbox (ver [AdminLayout.tsx](src/components/layouts/AdminLayout.tsx) y [DoctorLayout.tsx](src/components/layouts/DoctorLayout.tsx)). La tabla `notifications` está en la publicación `supabase_realtime`.

### Webhooks salientes (HMAC)

Cuando ocurre un evento (cita creada, cancelada, recordatorio, etc.), el código llama a la Edge Function [dispatch-webhook](supabase/functions/dispatch-webhook/index.ts), que recorre `webhooks` activos suscritos al `event_type` y hace `POST` al `url` configurado, firmando el body con HMAC‑SHA‑256 (`X-FindMed-Signature`, `X-FindMed-Event`). Este es el canal por el que se dispara WhatsApp a través de n8n u orquestador equivalente.

---

## 5. Roles del sistema

Enum `app_role` (SQL): `superadmin | admin | doctor`. El rol se lee de `public.users.role` y se expone por `useAuth().role`. Los pacientes **no** tienen cuenta ni rol: su acceso es por token.

### admin / superadmin

- **Layout**: [AdminLayout](src/components/layouts/AdminLayout.tsx) (sidebar “Panel Administrativo”).
- **Rutas** (todas bajo `/admin/…`, definidas en [App.tsx](src/App.tsx)):
  - `/admin/calendario` → vista de calendario semanal con todas las citas, filtrable por doctor.
  - `/admin/reservas` → tabla/listado de citas con búsqueda y filtros.
  - `/admin/doctores` → CRUD de doctores (alta crea usuario auth + fila en `doctors` + `users`).
  - `/admin/catalogos` → CRUD de especialidades, ciudades, zonas, hospitales y laboratorios.
  - `/admin/inbox` → notificaciones (citas nuevas, canceladas, completadas, post‑consultas).
  - `/admin/webhooks` → gestión de webhooks salientes (protegido por [PasswordGate](src/components/admin/PasswordGate.tsx)).
  - `/admin/api-keys` → gestión de API keys para sistemas externos (protegido por PasswordGate).

### doctor

- **Layout**: [DoctorLayout](src/components/layouts/DoctorLayout.tsx) (sidebar con el nombre del doctor).
- **Rutas** (bajo `/doctor/…`):
  - `/doctor/agenda` → calendario semanal propio (incluye citas FindMed + eventos del Google/Outlook Calendar vinculado).
  - `/doctor/configuracion` → disponibilidad semanal, duración de cita, `min_confirm_hours_before`, overrides por día, vinculación de Google/Outlook Calendar y selección del calendario destino.
  - `/doctor/por-completar` → citas `completed` cuyo post‑consultation form aún no se llena (o está `pending`), con toggles para medicamentos, estudios, laboratorio, referencia, hospitalización.
  - `/doctor/inbox` → notificaciones dirigidas al doctor.

### paciente (sin login)

- **Rutas públicas** (sin layout autenticado):
  - `/reserva?token=…` → [Reserva.tsx](src/pages/patient/Reserva.tsx): valida la sesión (`reserve-validate`), muestra slots (`reserve-slots`) y crea la cita (`reserve-create`).
  - `/gestionar?token=…` → [Gestionar.tsx](src/pages/patient/Gestionar.tsx): ver detalles, cancelar (`manage-cancel`) o reagendar (`manage-reschedule`) una cita.

---

## 6. Base de datos

Schema `public`. Todas las tablas tienen **RLS habilitado**. Tipos completos en [src/integrations/supabase/types.ts](src/integrations/supabase/types.ts).

### Enums

| Enum | Valores |
|---|---|
| `app_role` | `superadmin`, `admin`, `doctor` |
| `appointment_status` | `scheduled`, `confirmed`, `cancelled`, `completed` |
| `cancel_reason` | `patient`, `doctor`, `no_confirmation`, `admin` (Mejora 1) |
| `notification_type` | `appointment_scheduled`, `appointment_cancelled_by_patient`, `appointment_cancelled_by_doctor`, `appointment_auto_cancelled`, `appointment_completed`, `postconsultation_submitted`, `appointment_rescheduled`, `appointment_cancelled_by_admin` (Mejora 1) |
| `post_consultation_status` | `pending`, `read`, `report_sent` |
| `booking_source` | `patient_self`, `admin_manual`, `doctor_manual` (Mejora 1) |

### Tablas principales

| Tabla | Propósito |
|---|---|
| `users` | Extensión de `auth.users`. Columnas: `id`, `email`, `role`, `doctor_id` (FK a `doctors`), `initial_password`, `created_at`. `useAuth` lee de aquí. |
| `user_roles` | Tabla separada para auditoría de roles (unique `(user_id, role)`). Consumida por `has_role` / `is_admin_or_superadmin`. |
| `doctors` | Perfil del doctor: `full_name`, `phone`. Los campos `address`, `city_id`, `zone_id`, `google_*`, `outlook_*` siguen presentes pero están **deprecated** desde Mejora 2 — ahora viven en `doctor_offices`. No escribir ni leer esos campos en código nuevo. |
| `doctor_offices` | **Mejora 2.** Un doctor puede tener N consultorios. Campos: `id`, `doctor_id` (FK), `name`, `address`, `city_id`, `zone_id`, `google_calendar_connected`, `google_refresh_token_ref`, `google_calendar_id`, `outlook_calendar_connected`, `outlook_refresh_token_ref`, `outlook_calendar_id`, `appointment_duration_minutes`, `display_color` (#hex), `is_active`, `is_deleted`, `created_at`, `updated_at`. Constraint partial unique `(doctor_id, zone_id) WHERE is_active AND NOT is_deleted`. Composite unique `(doctor_id, id)` para soportar FKs compuestas desde tablas hijas. |
| `doctor_specialties` | M:N doctor ↔ specialty. |
| `doctor_schedule_settings` | 1:1 con `doctors`. `appointment_duration_minutes` (default 30, **deprecated** — usar el del office), `min_confirm_hours_before` (default 24), `timezone` (default `America/Mexico_City`). |
| `doctor_weekly_availability` | Horarios semanales con `office_id` (FK compuesta a `doctor_offices`), `doctor_id`, `weekday` (0–6), `start_time`/`end_time`, `is_enabled`. El unique `(doctor_id, weekday)` fue eliminado en Mejora 2; múltiples bloques por día son válidos si no se traslapan dentro del mismo office. |
| `doctor_date_overrides` | Excepciones puntuales por fecha (`is_available`, `note`). Unique `(doctor_id, override_date)`. |
| `specialties` | Catálogo con `name`, `color`, `is_active`. |
| `cities` / `zones` / `hospitals` / `laboratories` | Catálogos geográficos y destinos para enviar reportes post‑consulta. |
| `patients` | Pacientes identificados por `phone` único + `full_name`. Teléfonos siempre normalizados a `+52XXXXXXXXXX`. |
| `reservation_sessions` | Token efímero (72 h). Tiene `office_id` (FK compuesta a `doctor_offices`). Lo crea `triage-webhook`. FK a `patients` y `doctors`. |
| `appointments` | Cita: `doctor_id`, `office_id` (FK compuesta a `doctor_offices`), `patient_id`, `start_at`, `end_at`, `status`, `cancel_reason`, `booking_source`, `created_by_user_id`, `symptoms`, `doctor_notes`, `google_event_id`, `outlook_event_id`, `created_from_session_id`. |
| `appointment_manage_tokens` | Tokens para que el paciente gestione su cita (confirmar/cancelar/reagendar). Expiran al finalizar la cita. Generados siempre con `createManageToken` de `_shared/manage-token.ts`. |
| `post_consultation_forms` | Formulario post‑consulta: observaciones, medicamentos recetados, estudios de imagen, laboratorio, referencia a especialista, hospitalización, `review_status`, destino del reporte (`report_destination_type`/`report_destination_id`), `report_sent_at`. |
| `notifications` | Feed para admin y doctor: `recipient_role`, `doctor_id`, `title`, `body`, `type`, `appointment_id`, `is_read`. En publicación realtime. |
| `webhooks` | Webhooks salientes firmados con HMAC: `url`, `events[]`, `secret`, `payload_overrides`, `is_active`. |
| `api_keys` | API keys externas: `key_hash` (SHA‑256), `key_prefix`, `is_active`, `last_used_at`. |

### Funciones SQL helper (`SECURITY DEFINER`, `search_path = public`)

- `has_role(_user_id, _role)` → boolean
- `is_admin_or_superadmin(_user_id)` → boolean
- `get_doctor_id_for_user(_user_id)` → uuid

Usadas en políticas RLS para evitar recursión y decidir acceso.

---

## 7. Edge Functions

Todas están en `supabase/functions/<nombre>/index.ts`, usan Deno, comparten `corsHeaders` y (según el caso) el service role key. Lista completa:

### Reserva pública (por token, sin auth)

| Función | Qué hace |
|---|---|
| `reserve-validate` | Valida el token de `reservation_sessions`, devuelve datos del doctor/paciente. |
| `reserve-slots` | Calcula slots disponibles para un doctor en una fecha: combina `doctor_weekly_availability`, `doctor_date_overrides`, citas existentes y eventos del calendario externo vinculado. |
| `reserve-create` | Crea la cita (`appointments`), emite evento en Google/Outlook Calendar del doctor, marca la sesión como usada y genera `appointment_manage_tokens` + URL `/gestionar`. |

### Gestión por paciente (por token, sin auth)

| Función | Qué hace |
|---|---|
| `manage-validate` | Valida `appointment_manage_tokens` y devuelve los datos de la cita. |
| `manage-cancel` | Cancela la cita con `cancel_reason = 'patient'`, elimina el evento del calendario externo, emite notificación + webhook. |
| `manage-reschedule` | Reagenda a otro slot: valida disponibilidad, actualiza `start_at`/`end_at` y el evento del calendario externo. |

### Acciones internas (auth de usuario / service role)

| Función | Qué hace |
|---|---|
| `confirm-appointment` | Marca cita como `confirmed` (admite `appointment_id`, `patient_phone` o `manage_token`). |
| `cancel-by-doctor` | Doctor autenticado cancela con `cancel_reason = 'doctor'`. |
| `update-appointment-status` | Endpoint con API key para cambiar estado (p. ej. confirmaciones/cancelaciones por WhatsApp). |
| `generate-manage-link` | Genera/reusa un token para enviar al paciente el link `/gestionar`. |
| `create-doctor` | Admin crea usuario auth + fila en `doctors` + `users` + `doctor_schedule_settings`. |
| `seed-admin` | Bootstrap de usuario admin o doctor de prueba. |
| `search-doctors` | Endpoint público con API key para buscar doctores (usado por el triaje externo). |

### Gestión de citas por admin (Mejora 1)

| Función | Qué hace |
|---|---|
| `admin-create-appointment` | Admin crea cita con datos de paciente; dedup por teléfono, manage_token, sync calendario, webhooks `appointment.created` + `appointment.status_changed`. `booking_source = admin_manual`. |
| `admin-reschedule-appointment` | Admin reagenda cita: valida disponibilidad, actualiza timestamps, sync PATCH/CREATE en calendario externo, notificación + webhook. |
| `admin-cancel-appointment` | Admin cancela cita con `cancel_reason = admin`, elimina evento externo, notificación + webhook. |
| `admin-search-patients` | Búsqueda de pacientes por nombre/teléfono para el autocomplete del admin. Requiere rol admin. |

### Multi-consultorio CRUD (Mejora 2)

| Función | Qué hace |
|---|---|
| `doctor-office-create` | Crea nuevo consultorio. Auth: admin o doctor dueño. Valida zona única entre activos. |
| `doctor-office-update` | Actualiza metadata, calendario conectado o hace disconnect. Auth: admin o doctor dueño. |
| `doctor-office-delete` | Soft-delete del consultorio; cancela citas futuras (dry_run disponible). Auth: admin o doctor dueño. |

### Creación de citas por doctor (Mejora 2)

| Función | Qué hace |
|---|---|
| `doctor-create-appointment` | Doctor crea cita directamente desde su agenda. Mismo flujo que `admin-create-appointment` pero con auth de doctor (`requireAdminOrDoctor`). `booking_source = doctor_manual`. |
| `doctor-reschedule-appointment` | Doctor reagenda cita de su propia agenda. Mismo flujo que `admin-reschedule-appointment` pero con auth de doctor. |

### Helpers compartidos (`supabase/functions/_shared/`)

| Archivo | Para qué sirve |
|---|---|
| `cors.ts` | `corsHeaders` y helper `jsonResponse(data, status)`. |
| `auth.ts` | `requireAdmin`, `requireAdminOrDoctor` — validan JWT y rol antes de operar. |
| `phone.ts` | `normalizeMxPhone` (canonicaliza `+52XXXXXXXXXX`) y `mxPhoneLookupVariants` (variantes para lookup). |
| `manage-token.ts` | `createManageToken` — genera token + URL `/gestionar` e inserta en `appointment_manage_tokens`. |
| `slot-validation.ts` | `validateSlotAvailable` — verifica que un slot no colisione con citas existentes en el mismo office. |
| `availability-check.ts` | `checkAvailability` — verifica si un slot cae dentro de la disponibilidad semanal configurada del office. |
| `office-resolver.ts` | Helpers para resolver el office a partir de doctor_id (p. ej. office primario para backwards-compat). |
| `calendar-tokens.ts` | `getGoogleAccessToken`, `getOutlookAccessToken` — intercambian refresh token por access token vía el secret del office. |

### Triaje / recordatorios / webhooks

| Función | Qué hace |
|---|---|
| `triage-webhook` | Endpoint con API key. Upsert de paciente por teléfono, crea `reservation_sessions` (72 h) y devuelve `reserve_url`. Punto de entrada desde el bot de WhatsApp. |
| `dispatch-webhook` | Dispara eventos a todos los `webhooks` activos suscritos, firmando con HMAC‑SHA‑256. Llamada internamente por otras funciones. |
| `send-appointment-reminders` | Cron: busca citas `scheduled` en ventana 47–49 h y emite `appointment.reminder_48h`. |
| `send-day-of-reminders` | Cron: busca citas `confirmed` del día (timezone México) y emite recordatorio del día. |
| `auto-cancel-unconfirmed` | Cron: cancela citas no confirmadas cuando el umbral `min_confirm_hours_before` ha pasado, con `cancel_reason = 'no_confirmation'`. |

### Google Calendar (OAuth + gestión)

| Función | Qué hace |
|---|---|
| `google-calendar-auth` | Inicia el flujo OAuth; devuelve URL de autorización. |
| `google-calendar-callback` | Recibe el code, intercambia por refresh token y lo guarda en `doctors.google_refresh_token_ref`. |
| `google-calendar-list` | Lista calendarios disponibles del doctor. |
| `google-calendar-events` | Obtiene eventos del calendario vinculado (para la Agenda del doctor). |
| `google-calendar-create-event` / `google-calendar-update-event` / `google-calendar-delete-event` | CRUD de eventos al sincronizar citas. |

### Outlook Calendar (Microsoft Graph, mismo patrón)

`outlook-calendar-auth`, `outlook-calendar-callback`, `outlook-calendar-list`, `outlook-calendar-events`, `outlook-calendar-create-event`, `outlook-calendar-update-event`, `outlook-calendar-delete-event`.

---

## 8. Integraciones externas

### Google Calendar

- OAuth con refresh token. El token se persiste referenciado en `doctors.google_refresh_token_ref` (el token real vive en el secret storage de Supabase / variable del edge function).
- El doctor elige su calendario desde `/doctor/configuracion`; el id se guarda en `doctors.google_calendar_id`.
- Cada cita FindMed crea/actualiza/elimina un evento en ese calendario (`appointments.google_event_id`).
- La `/doctor/agenda` pinta citas FindMed **+** eventos externos leídos por `google-calendar-events`.
- Flujo OAuth abre popup → callback → popup cierra y postea `"google-calendar-connected"` al opener ([GoogleCalendarSuccess.tsx](src/pages/GoogleCalendarSuccess.tsx)).
- **Redirect URI con dominio propio (proxy de Vercel).** Para que el consent screen de Google muestre `app.findmed.com.mx` y no el host interno `*.supabase.co`, el `redirect_uri` que se envía a Google es `https://app.findmed.com.mx/oauth/google/callback`. Esa ruta **no** existe en el SPA: [vercel.json](vercel.json) tiene un rewrite (antes del catch-all a `/index.html`) que la proxea a la Edge Function `google-calendar-callback` en Supabase, preservando query params (`code`, `state`, …), método y headers. El URI lo define un único helper compartido [`_shared/oauth-redirect.ts`](supabase/functions/_shared/oauth-redirect.ts) (`getGoogleCalendarRedirectUri`), importado tanto por `google-calendar-auth` (construcción de la URL de auth) como por `google-calendar-callback` (intercambio code→token), para que sean byte-idénticos y nunca haya `redirect_uri_mismatch`. El origen real del frontend (localhost/staging/prod) viaja en el `state`, no en el `redirect_uri`, así que un solo URI de producción sirve para todos los entornos. Override opcional vía secret `GOOGLE_OAUTH_REDIRECT_URI`. El URI viejo (`https://<project>.supabase.co/functions/v1/google-calendar-callback`) debe seguir registrado en Google Cloud Console en paralelo para no romper flujos en vuelo.

### Outlook Calendar

Mismo patrón que Google sobre Microsoft Graph (`outlook_refresh_token_ref`, `outlook_calendar_id`, `outlook_calendar_connected`, `appointments.outlook_event_id`). Popup análogo en [OutlookCalendarSuccess.tsx](src/pages/OutlookCalendarSuccess.tsx).

### WhatsApp (vía Whaapy / n8n / orquestador externo)

No hay SDK de WhatsApp en el repo. La integración es **bidireccional vía webhooks + API keys**:

- **Salida (FindMed → WhatsApp)**: cuando ocurre un evento (`appointment.created`, `appointment.confirmed`, `appointment.cancelled`, `appointment.reminder_48h`, `appointment.reminder_day_of`, `postconsultation.submitted`, …), [dispatch-webhook](supabase/functions/dispatch-webhook/index.ts) recorre `webhooks` suscritos y hace `POST` al URL configurado, firmando el body con HMAC‑SHA‑256 y los headers `X-FindMed-Signature` / `X-FindMed-Event`. El consumidor (ej. n8n/Whaapy) traduce eso a un mensaje de WhatsApp.
- **Entrada (WhatsApp → FindMed)**: el bot externo llama, con `Authorization: Bearer fm_…`, a:
  - `triage-webhook` → crear/actualizar paciente y generar link `/reserva`.
  - `update-appointment-status` → confirmar/cancelar cita por texto (comentario en el código: “reuse for confirmed via WhatsApp”).
  - `search-doctors` → listar doctores disponibles durante el triaje.

La página `/admin/webhooks` gestiona los endpoints suscritos y `/admin/api-keys` las credenciales de entrada.

---

## 9. Patrones y convenciones

### Convenciones de archivos

- Componentes en PascalCase (`AppointmentDetailDialog.tsx`), páginas en PascalCase, hooks en camelCase con prefijo `use` (`useAuth.tsx`, `use-toast.ts`).
- Páginas bajo `src/pages/<role>/<PageName>.tsx` y se importan en [App.tsx](src/App.tsx).
- Diálogos específicos de rol en `src/components/<role>/`.
- Componentes shadcn en `src/components/ui/` (generados por el CLI de shadcn; no se renombran).

### shadcn/ui

- Para cualquier componente nuevo de UI preferir **añadirlo vía shadcn** en `src/components/ui/` antes que crear uno desde cero.
- Se importa siempre con alias: `import { Button } from "@/components/ui/button"`.
- Si falta un componente de shadcn que se necesita, genéralo con `npx shadcn@latest add <componente>` (style `default`, según [components.json](components.json)).
- `cn()` de `@/lib/utils` se usa para concatenar clases con merge de Tailwind.

### Estilos

- Colores siempre en **HSL** y mediante tokens de [src/index.css](src/index.css) (`--primary`, `--cta`, `--destructive`, `--scheduled`, `--confirmed`, `--sidebar-*`, etc.). Usar `bg-primary`, `text-cta-foreground`, `border`, etc. en vez de hex directos.
- Layouts con Flexbox/Grid + utilidades de Tailwind. Dark mode está configurado (`darkMode: ["class"]`) aunque el theming actual es claro.

### Data fetching con react-query

- `QueryClientProvider` único en [App.tsx](src/App.tsx).
- **Lecturas**: `useQuery` con `queryKey` descriptivo, típicamente `[nombre, …deps]` (p. ej. `["doctor-settings", doctorId]`).
- **Mutaciones**: `useMutation` → en `onSuccess` invalidar la query relacionada (`queryClient.invalidateQueries({ queryKey: [...] })`).
- Para updates por realtime (notifications): suscribirse a `supabase.channel(...).on("postgres_changes", …)` e invalidar queries desde el callback. Ver patrón en [AdminLayout.tsx](src/components/layouts/AdminLayout.tsx).
- Evitar `fetch` crudo dentro de componentes **excepto** para llamar Edge Functions desde páginas públicas sin auth (ej. [Reserva.tsx](src/pages/patient/Reserva.tsx), [Gestionar.tsx](src/pages/patient/Gestionar.tsx)). En el resto se usa `supabase.from(...)`.

### Supabase queries

- Importar siempre `import { supabase } from "@/integrations/supabase/client"`.
- Aprovechar los tipos de `@/integrations/supabase/types` (`Database["public"]["Enums"]["app_role"]`, etc.) en lugar de strings sueltos.
- Para joins usar la sintaxis `select("col, related_table(col)")`; ya se usa en la agenda y reservas.

### Fechas y timezone

- Timezone canónico del negocio: `America/Mexico_City`. Cuando se manipulen horas locales del doctor, **convertir** con `toZonedTime` de `date-fns-tz` — ver [Agenda.tsx](src/pages/doctor/Agenda.tsx).
- Formateos en español con `locale: es` de `date-fns/locale`.

### Edge Functions

- Cada función exporta con `Deno.serve(...)`, responde a `OPTIONS` con `corsHeaders` y valida `method === "POST"` cuando aplica.
- Autenticación por tipo:
  - **Service‑role** (interno): `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`.
  - **Usuario autenticado**: verificar el JWT con `auth.getClaims` o cliente anon con el header `Authorization`.
  - **API Key externa**: header `Authorization: Bearer fm_…`, validar contra `api_keys.key_hash` (SHA‑256 hex).
- El CORS header `Access-Control-Allow-Headers` incluye los propios de supabase‑js v2 (`x-supabase-client-*`); mantenerlos al copiar a funciones nuevas.

### Notificaciones

- Toasts: usar `sonner` (`import { toast } from "sonner"`) o el `useToast` de shadcn según lo que ya se use en el archivo. No mezclar en la misma vista.

### Teléfonos de pacientes

- Siempre normalizar con `normalizeMxPhone` antes de insertar o actualizar. Siempre buscar con `mxPhoneLookupVariants` para `.in("phone", variants)`. Nunca insertar/buscar por `phone` sin normalización.

### Tokens de gestión

- Usar siempre el helper `createManageToken` de `_shared/manage-token.ts`. No reimplementar inline en ninguna Edge Function.

### Validación de disponibilidad

- Usar `checkAvailability` de `_shared/availability-check.ts` en **cualquier** endpoint que cree o reagende citas, incluyendo las Edge Functions de Google/Outlook calendar event create/update. Enumerar todas las funciones afectadas antes de implementar y verificar cobertura una a una.

### Multi-consultorio

- Ningún flujo nuevo asume un consultorio único por doctor. Siempre operar por `office_id` explícito. Los tokens OAuth, calendarios conectados y `appointment_duration_minutes` viven en `doctor_offices`, no en `doctors`.

---

## 10. Variables de entorno

### `.env` (cliente — prefijo `VITE_`)

| Variable | Descripción |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase (base para `supabase-js` y para construir llamadas a `/functions/v1/...`). |
| `VITE_SUPABASE_PROJECT_ID` | ID del proyecto Supabase. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon/publishable key (rol `anon` del JWT). Incluida en el bundle del cliente y usada en los fetch a Edge Functions públicas. |

### Secrets usados por Edge Functions (se configuran en Supabase, **no** en `.env` del repo)

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto (inyectada por Supabase en el runtime de las funciones). |
| `SUPABASE_ANON_KEY` | Anon key (para validar JWTs de usuarios desde las funciones). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (acceso total, bypasea RLS). Requerido por prácticamente todas las Edge Functions. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client de Google Cloud para Google Calendar. |
| `GOOGLE_OAUTH_REDIRECT_URI` | **Opcional.** Override del redirect URI de Google Calendar. Si no se define, usa `https://app.findmed.com.mx/oauth/google/callback` (proxeado por Vercel a `google-calendar-callback`). Debe ser el mismo en `google-calendar-auth` y `google-calendar-callback` (es project-level, ambas lo leen). |
| `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET` | App registration de Microsoft (Azure AD) para Outlook Calendar. |
| `APP_URL` | URL pública de la app (producción: URL de Vercel; desarrollo: `http://localhost:5173`); se usa para construir links `/reserva?token=…` y `/gestionar?token=…`. Actualizar en Supabase al hacer deploy. |

No commitear claves nuevas al repo. El `.env` actual sólo contiene las variables `VITE_*` del cliente.

---

## 11. Reglas para Claude Code al trabajar en este proyecto

**Hacer:**

0. **Antes de empezar cualquier cambio, leer `ERRORES.md`** para no repetir errores conocidos. Tras descubrir un error nuevo, agregarlo a `ERRORES.md` antes de cerrar el prompt.
1. Usar **shadcn/ui** para cualquier componente nuevo de UI. Si falta un componente, añadirlo con `npx shadcn@latest add <componente>` siguiendo la config de [components.json](components.json) (style `default`, baseColor `slate`, CSS variables).
2. Usar **react-query** (`useQuery` / `useMutation`) para todo data fetching contra Supabase. Invalidar queries tras mutaciones con `queryClient.invalidateQueries({ queryKey: [...] })`.
3. Importar el cliente Supabase desde `@/integrations/supabase/client` y aprovechar los tipos de `@/integrations/supabase/types`.
4. Respetar el sistema de design tokens: usar clases Tailwind basadas en variables CSS (`bg-primary`, `text-cta-foreground`, `border-border`, `bg-destructive`, etc.) en vez de colores hex en línea.
5. Mantener los **patrones existentes** del archivo que estás tocando (convención de imports, uso de `cn()`, forma de manejar errores, tipo de toast, estructura de `queryKey`).
6. Para flujos con paciente sin login, usar siempre **tokens** (`reservation_sessions.token` o `appointment_manage_tokens.token`) y Edge Functions; nunca exponer queries directas a Postgres sin RLS.
7. Para endpoints externos (bots, n8n), autenticar con API keys con prefijo `fm_` validando el hash SHA‑256 contra `api_keys`.
8. Tras cada cambio funcional **verificar que el build pasa**: `npm run build` (o `bun run build`) y `npm run lint`. Si el cambio toca tipos o RLS, correr además `npm run test`. **Build pasando ≠ feature funcionando.** Cuando el prompt pide verificación manual, hacer la verificación o reconocer explícitamente cuando no se puede (ej. sin acceso a navegador headless).
8b. Cuando un cambio afecta a múltiples Edge Functions (ej. "todas las que crean citas"), enumerarlas explícitamente y verificar cobertura una por una. No asumir cobertura por implicación.
9. Hacer **git commit después de cada cambio funcional** con mensaje descriptivo del *porqué*. Commits pequeños y atómicos; no mezclar features.
10. Al añadir una tabla o columna: crear una **migración SQL nueva** en `supabase/migrations/` con el timestamp correcto, incluir RLS + policies, y regenerar `src/integrations/supabase/types.ts`.
11. Al añadir un evento nuevo a webhooks, añadirlo a `EVENT_GROUPS` en [src/pages/admin/Webhooks.tsx](src/pages/admin/Webhooks.tsx) y disparar desde donde corresponda vía `dispatch-webhook`.
12. Todo texto visible al usuario va en **español** (la app está localizada; usar `locale: es` en `date-fns`).

**No hacer:**

1. **No modificar flujos que no sean parte del scope del prompt.** Si el usuario pide ajustar la Agenda del doctor, no tocar el Inbox, las reservas públicas ni Webhooks aunque parezca que necesitan limpieza.
2. No crear componentes desde cero si shadcn/ui ya lo tiene.
3. No introducir nuevas librerías sin necesidad (hay recharts, embla, sonner, cmdk, etc. ya disponibles).
4. No llamar `fetch` a Supabase desde el frontend autenticado — usar el cliente tipado.
5. No omitir RLS en tablas nuevas. Nunca usar service role key desde el cliente.
6. No guardar secretos en `.env` cliente ni en el repo. Si una función nueva necesita un secret, documentarlo en este archivo y pedir al usuario que lo configure en Supabase.
7. No asumir timezone UTC ni local del usuario — usar `America/Mexico_City` para todo lo relacionado con horarios de doctor/paciente.
8. No deshabilitar RLS ni hacer `--no-verify` en git.
9. No cambiar la forma de autenticación (`useAuth`) ni el contrato de `ProtectedRoute` sin confirmar con el usuario.
10. No editar archivos dentro de `src/components/ui/` salvo que se haya discutido explícitamente — esos vienen del generador de shadcn y se regeneran.
11. No borrar o renombrar Edge Functions existentes: otros sistemas externos (bot de WhatsApp, n8n) dependen de los nombres actuales.
12. No usar defaults literales (`= []`, `= {}`) al destructurar resultados de hooks que pueden devolver `undefined` cuando el valor se usa como dependencia de `useEffect` — causa loops infinitos.
13. No usar `queryClient.invalidateQueries` sin `placeholderData: keepPreviousData` en queries que renderizan listas visibles al usuario — causa flashes de UI vacía.

---

_Última actualización: 2026-06-04._
