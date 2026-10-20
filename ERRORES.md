# ERRORES.md — Bitácora de errores del proyecto FindMed

Propósito: registrar errores cometidos en la historia del proyecto, su causa raíz y la solución aplicada, para no repetirlos.

**Formato de cada entrada:**

```
## YYYY-MM-DD — Título corto
Categoría: frontend | backend | schema | deploy | cobertura | datos | otro
Síntoma → Causa raíz → Solución → Lección
```

Cualquier error nuevo descubierto a partir de las sesiones documentadas aquí se agrega como entrada nueva al final del documento.

---

## 2026-04-28 — Cobertura parcial reportada como completa: validación de disponibilidad

**Categoría:** cobertura

**Síntoma:** La validación de horario fue reportada como "implementada en todas las funciones" pero al crear cita desde el calendario del doctor (via `google-calendar-create-event` o `outlook-calendar-create-event`) el sistema creaba eventos fuera del horario configurado sin advertencia.

**Causa raíz:** La implementación solo cubría 3 Edge Functions (`admin-create-appointment`, `admin-reschedule-appointment`, `manage-reschedule`). Las 4 funciones de Google/Outlook calendar event create/update nunca llamaban a `checkAvailability`. Adicionalmente, el frontend mandaba ISO naive sin offset (`${date}T${startTime}:00` en lugar de `${date}T${startTime}:00-06:00`), rompiendo la comparación de zona horaria en el backend.

**Solución aplicada:** Agregar `checkAvailability` con flag `force_outside_availability` a las 4 funciones faltantes (`google-calendar-create-event`, `google-calendar-update-event`, `outlook-calendar-create-event`, `outlook-calendar-update-event`), y cambiar el frontend de `CreateEventDialog.tsx` a `${date}T${startTime}:00-06:00`.

**Lección aprendida:** Cuando una mejora afecta a múltiples Edge Functions, enumerarlas explícitamente y verificar cobertura una por una. Nunca asumir cobertura por implicación. El checklist de verificación debe listar cada función afectada.

---

## 2026-04-28 — Imports olvidados tras rewrite: Card is not defined

**Categoría:** frontend

**Síntoma:** Pantalla de Configuración del doctor en blanco. Consola mostraba `ReferenceError: Card is not defined`.

**Causa raíz:** Durante un rewrite de `OfficeCalendarConnector.tsx`, se agregaron `<Card>` y `<CardContent>` al JSX pero no se importaron de `@/components/ui/card`. TypeScript compila igual porque el bundler no detecta referencias de componentes JSX que existen en otros scopes.

**Solución aplicada:** Agregar el import faltante: `import { Card, CardContent } from "@/components/ui/card"`.

**Lección aprendida:** Tras rewrite parcial de un componente, verificar que renderiza en navegador, no solo que el build pasa. Los errores de import de componentes React solo se detectan en runtime.

---

## 2026-04-28 — Loop infinito por referencia inestable de array literal como default

**Categoría:** frontend

**Síntoma:** `Maximum update depth exceeded` en consola; pantalla en blanco.

**Causa raíz:** En `UnifiedAvailabilityEditor.tsx`, la query de TanStack se destructuraba con default literal: `data: existing = []`. Mientras la query estaba loading, ese `[]` era una referencia nueva en cada render. El `useEffect` con `[existing]` como dependencia lo veía cambiar siempre y disparaba `setRows()` infinitamente.

**Solución aplicada:** Quitar el default literal. Dejar `existing` como `undefined` y manejar con guard explícita dentro del effect: `if (existing) setRows(existing)`.

**Lección aprendida:** Nunca usar defaults literales (arrays/objetos) al destructurar resultados de hooks que pueden devolver `undefined` cuando el valor se usa como dependencia de `useEffect`. Crear la variable fuera del hook con tipo explícito.

---

## 2026-04-28 — Invalidación agresiva de TanStack Query causando flashes de UI vacía

**Categoría:** frontend

**Síntoma:** Al guardar info de un consultorio, conectar/desconectar calendarios, o cambiar de pestaña del navegador, los demás consultorios desaparecían momentáneamente y la disponibilidad se vaciaba.

**Causa raíz:** `queryClient.invalidateQueries` ponía la query en estado pending con `data: undefined`, lo que desmontaba la lista entera durante el refetch.

**Solución aplicada:** Agregar `placeholderData: keepPreviousData` + `staleTime: 30_000` a las queries afectadas (`offices`, `availability`). También usar `setQueryData` en lugar de `invalidateQueries` para operaciones optimistas (e.g. `switchCalendar` en `OfficeCalendarConnector`).

**Lección aprendida:** Para queries que renderizan listas visibles al usuario, siempre usar `keepPreviousData` cuando otras mutaciones las pueden invalidar. La UI nunca debe vaciarse visualmente mientras se hace refresh en background.

---

## 2026-04-28 — Campos legacy duplicados en distintas pantallas

**Categoría:** frontend

**Síntoma:** Tras quitar el campo de dirección del doctor de `Configuracion.tsx`, seguía apareciendo en otra parte de la UI del doctor.

**Causa raíz:** `DoctorProfileCard.tsx` también tenía un editor con `address`, no se quitó allá.

**Solución aplicada:** Quitar también de `DoctorProfileCard.tsx`. Agregar comentario marcando `doctor.address` como deprecated.

**Lección aprendida:** Cuando se quita un campo del frontend, hacer grep global del nombre del campo para encontrar todos los lugares donde se usa. No asumir que el archivo principal es el único lugar.

---

## 2026-04-28 — Discrepancia de proyectos Supabase en CLI vs `.env`

**Categoría:** deploy

**Síntoma:** Deploy aparentemente exitoso pero los cambios no se reflejaban en producción.

**Causa raíz:** `supabase/config.toml` apuntaba al proyecto viejo `iepdgygvztocornqkkhk` (Lovable) mientras el `.env` y el CLI estaban configurados para el nuevo `jyzvdowflblxmlahlupo`.

**Solución aplicada:** Actualizar `supabase/config.toml` con el `project_id` correcto.

**Lección aprendida:** Al migrar entre proyectos Supabase, verificar consistencia entre `.env`, `supabase/config.toml` y el linked project del CLI (`supabase status`). Antes de cualquier deploy, confirmar el `project_id` activo con `supabase status`.

---

## 2026-04-28 — Foreign keys no anticipadas en cleanup SQL

**Categoría:** schema

**Síntoma:** `DELETE FROM patients` falla con FK violation.

**Causa raíz:** Cadenas de FK no obvias: `patients` → `reservation_sessions` → `appointments` → `notifications` / `appointment_manage_tokens`.

**Solución aplicada:** Limpiar en orden de dependencia: `notifications` → `appointment_manage_tokens` → `appointments` → `reservation_sessions` → `patients`.

**Lección aprendida:** Antes de borrar registros padre, mapear todas las tablas hijas con `SELECT conname, confrelid FROM pg_constraint WHERE confrelid = 'public.X'::regclass`, y limpiar en orden inverso de dependencia.

---

## 2026-04-28 — Cobertura insuficiente de event_types en webhooks para n8n

**Categoría:** backend

**Síntoma:** Webhook `appointment.status_changed` no se disparaba al admin crear cita; n8n no notificaba al paciente por WhatsApp.

**Causa raíz:** En n8n el flujo distinguía por `event_type` y necesitaba específicamente `appointment.status_changed`. La Edge Function solo disparaba `appointment.created`.

**Solución aplicada:** Emitir ambos eventos en paralelo desde `admin-create-appointment`: `appointment.created` y `appointment.status_changed`.

**Lección aprendida:** Cuando un sistema externo (n8n) consume eventos firmados, verificar cuáles `event_type` el sistema externo espera, no solo los que parecen obvios desde el backend. El payload de n8n debe documentarse como parte de la spec de cada Event Function.

---

## 2026-04-27 — Tokens duplicados en múltiples Edge Functions con generación inline

**Categoría:** backend

**Síntoma:** `manage_token` con formato/expiración inconsistente entre funciones. Pacientes recibían links que expiraban incorrectamente.

**Causa raíz:** Cada Edge Function que necesitaba generar un token lo hacía inline con código copiado, y con el tiempo cada copia divergió.

**Solución aplicada:** Helper compartido `_shared/manage-token.ts` con `generateManageToken` y `createManageToken`, migrando todas las funciones que generaban tokens.

**Lección aprendida:** Lógica que se repite en 3+ funciones debe vivir en `_shared/`. Antes de implementar funcionalidad nueva en una Edge Function, revisar si ya existe en otra o en `_shared/`.

---

## 2026-04-27 — Teléfonos sin normalización causando duplicados de pacientes

**Categoría:** datos

**Síntoma:** Pacientes duplicados con el mismo número en distintos formatos (`+52...` vs `+521...`, con y sin espacios).

**Causa raíz:** El flujo del paciente y el del admin insertaban con el formato recibido sin normalizar; el lookup tampoco buscaba variantes.

**Solución aplicada:** Helpers `_shared/phone.ts` con `normalizeMxPhone` (canonicaliza a `+52XXXXXXXXXX`) y `mxPhoneLookupVariants` (devuelve variantes para `.in("phone", variants)`).

**Lección aprendida:** Para datos clave como teléfonos, definir formato canónico desde el principio y aplicarlo en escritura Y lectura. El formato `+52XXXXXXXXXX` (10 dígitos sin el `1` de Telcel) es el canónico.

---

## 2026-04-27 — Pop-up de OAuth termina en 404 tras migración de hosting

**Categoría:** deploy

**Síntoma:** Tras conectar Google/Outlook, el pop-up muestra "404 - page not found" aunque el OAuth fue exitoso.

**Causa raíz:** El callback redirigía a `SITE_URL` (env var no actualizada al migrar de Lovable a Vercel/dev local), no al origen real desde donde se abrió el pop-up.

**Solución aplicada:** Encodear `origin` en el OAuth state como tercera parte (`${doctorId}:${officeId}:${b64(origin)}`). El callback decodea y redirige al origen real del frontend.

**Lección aprendida:** Para OAuth con popups, el origen del frontend lo determina el frontend en runtime con `window.location.origin`, no debe depender solo de env vars del backend. Siempre pasarlo en el state del OAuth.

---

## 2026-04-29 — Color de consultorio guardado en código pero función no desplegada

**Categoría:** deploy

**Síntoma:** Se reportó como "arreglado" que `display_color` se guardaba al editar consultorio, pero en pruebas reales el color seguía siendo el anterior tras guardar y recargar la página.

**Causa raíz:** El fix consistía en agregar `display_color` a la interfaz `Body` de `doctor-office-update` y al bloque de updates. El código fue cambiado en el working tree pero nunca se ejecutó `supabase functions deploy doctor-office-update`. El deployed code seguía siendo la versión anterior sin soporte para el campo.

**Solución aplicada:** Verificar que el código en el repositorio es correcto y hacer deploy explícito de la función.

**Lección aprendida:** "Fix en código" no equivale a "fix en producción". Nunca marcar un bug como arreglado sin hacer deploy y verificar con SQL que el valor cambió en DB.

---

## 2026-04-29 — Fix de validación al editar consultorio introdujo regresión: botón Guardar siempre deshabilitado

**Categoría:** frontend

**Síntoma:** En `OfficeFormDialog.tsx` al abrir el diálogo de edición de un consultorio existente, el botón "Guardar cambios" permanecía deshabilitado aunque se modificara cualquier campo. Cualquier consultorio creado sin dirección/ciudad/zona quedaba permanentemente bloqueado.

**Causa raíz:** Un fix previo (P4) para hacer el `name` requerido también en edición removió los guards `if (!isEdit)` de address, city_id y zone_id. Pero el EF `doctor-office-update` acepta esos campos como opcionales (pueden ser `null`). Los consultorios existentes con esos valores null inicializan el formulario con `""`, la validación falla inmediatamente, y `canSubmit` queda `false` desde el primer render. Adicionalmente, no había ningún tracking de `isDirty`, por lo que el botón no podía habilitarse al cambiar un campo en modo edición.

**Solución aplicada:** Restaurar los guards `if (!isEdit)` para address/cityId/zoneId (solo requeridos en modo crear). Agregar comparación `isDirty` contra los valores originales del office prop. `canSubmit = errores vacíos && !submitting && isDirty`.

**Lección aprendida:** Al cambiar validaciones de un formulario que tiene modo crear/editar, revisar explícitamente qué campos son requeridos en cada modo. El EF es la fuente de verdad: si el EF acepta `null`, el formulario no puede marcar ese campo como requerido en edición. Los formularios de edición siempre deben incluir un check `isDirty` para no habilitar el botón cuando nada cambió.

---

## 2026-04-29 — Soft-delete de consultorio no limpia filas dependientes (disponibilidad y sesiones huérfanas)

**Categoría:** backend

**Síntoma:** Al borrar un consultorio, los bloques de `doctor_weekly_availability` con ese `office_id` quedaban en la tabla. En la UI del doctor aparecían bloques "sin consultorio" con selector vacío. Además, links de reserva activos (`reservation_sessions`) seguían apuntando al consultorio ya eliminado.

**Causa raíz:** La FK `doctor_weekly_availability → doctor_offices` tiene `ON DELETE CASCADE` en el schema, pero el borrado en la app es siempre soft (UPDATE `is_deleted=true`, no DELETE real). El CASCADE nunca disparaba. El EF `doctor-office-delete` tampoco hacía limpieza explícita de las tablas dependientes.

**Solución aplicada:** Agregar a `doctor-office-delete`, antes del soft-delete del office: `DELETE FROM doctor_weekly_availability WHERE office_id = <id>` y `DELETE FROM reservation_sessions WHERE office_id = <id>`.

**Lección aprendida:** ON DELETE CASCADE en el schema es una red de seguridad para hard-deletes, pero no sirve cuando los deletes son soft (UPDATE). Cuando se diseña un flujo de soft-delete, listar todas las tablas dependientes (por FK directa o por `office_id` semántico) y decidir explícitamente qué se limpia en el EF.

---

## 2026-04-29 — Webhooks de cancelación con `event_type` incorrecto y sin `manage_url`

**Categoría:** backend

**Síntoma:** (A) `manage-cancel` disparaba `appointment.cancelled` en lugar de `appointment.cancelled_by_patient` — n8n usaba la plantilla equivocada. (B) `admin-cancel-appointment` y `doctor-office-delete` no incluían `manage_url` en el payload — n8n fallaba con 400 al intentar construir el botón URL de WhatsApp. (C) `cancel-by-doctor` y `auto-cancel-unconfirmed` incluían el URL como `reschedule_url` pero no como `manage_url`, rompiendo n8n que esperaba el campo estándar.

**Causa raíz:** Los EFs de cancelación fueron escritos en momentos distintos sin un contrato unificado para el `event_type` ni para los campos del payload. No había un checklist que verificara que todos los EFs de cancelación producen el mismo shape.

**Solución aplicada:** (A) Corregir `event_type` en `manage-cancel`. (B) Agregar helper `getOrCreateManageUrl` en `_shared/manage-token.ts` (lookup de token existente o crea uno nuevo) y llamarlo en `admin-cancel-appointment` y `doctor-office-delete`. (C) Agregar campo `manage_url` junto a `reschedule_url` en `cancel-by-doctor` y `auto-cancel-unconfirmed`.

**Lección aprendida:** Todos los webhooks de cancelación deben seguir el mismo contrato: `event_type` específico por actor (patient/doctor/admin/auto) y campo `manage_url` presente siempre. Al agregar un nuevo flujo de cancelación, verificar contra este checklist antes de desplegar.

---

## 2026-04-29 — Consultorio duplicado por estado de edición perdido durante glitch de UI

**Categoría:** frontend / datos

**Síntoma:** Doctor tenía dos consultorios "Bosques" activos en `doctor_offices`. Citas y disponibilidad estaban repartidas entre los dos.

**Causa raíz:** El formulario `OfficeFormDialog` en modo edición perdió el estado `editingOffice` (probablemente durante el flash de UI vacía por invalidación agresiva de TanStack Query, antes de ese fix). Al abrirse sin `office` prop, el formulario llamó al endpoint de crear en lugar de actualizar. No había restricción UNIQUE en `(doctor_id, name)` que lo hubiera bloqueado.

**Solución aplicada:** (A) Migración SQL `20260429200000_cleanup_duplicate_offices.sql` que mueve las citas al consultorio original, elimina disponibilidad y sesiones del duplicado, y hace soft-delete del duplicado. (B) `CREATE UNIQUE INDEX doctor_offices_active_name_unique ON doctor_offices(doctor_id, name) WHERE is_active AND NOT is_deleted`. (C) Actualizar `doctor-office-create` EF para devolver `name_taken` cuando se viola la nueva constraint. (D) `OfficeFormDialog` maneja `name_taken` con mensaje amigable.

**Lección aprendida:** Las constraints de unicidad deben reflejar las invariantes del negocio desde el inicio. Si el negocio dicta "un nombre de consultorio único por doctor activo", eso debe ser una constraint en DB, no solo validación en frontend. Las constraints previenen corrupción de datos aunque haya bugs de UI.

---

## 2026-04-29 — Eventos de Google Calendar no aparecían en calendario del admin

**Categoría:** frontend

**Síntoma:** Al filtrar el calendario admin por un doctor, aparecían los eventos de Outlook pero no los de Google, aunque el doctor tenía Google Calendar conectado en su consultorio.

**Causa raíz:** `Calendario.tsx` derivaba `googleEnabled` / `outlookEnabled` de `filteredDoctorRow?.google_calendar_connected`, que lee de la tabla `doctors`. Ese campo está **deprecated** desde Mejora 2 — ahora el estado de conexión vive en `doctor_offices`. El campo en `doctors` estaba en `false` para Google (nunca actualizado) pero en `true` para Outlook (actualizado recientemente por coincidencia al conectar el consultorio duplicado).

**Solución aplicada:** Ampliar la query `doctorOfficeOptions` en `Calendario.tsx` para incluir `google_calendar_connected, outlook_calendar_connected`. Derivar las flags `googleEnabled` / `outlookEnabled` con `.some(o => o.google_calendar_connected)` sobre los consultorios del doctor filtrado.

**Lección aprendida:** Cuando un campo migra de una tabla a otra (aquí: de `doctors` a `doctor_offices`), hacer grep de todos los sitios que leen el campo viejo y actualizarlos en la misma sesión. Un campo deprecated en el schema es invisible para el compilador — solo búsqueda explícita lo revela.

---

## 2026-04-30 — Cron jobs perdidos al migrar entre proyectos Supabase

**Categoría:** deploy

**Síntoma:** Tras migrar de proyecto Supabase viejo (`iepdgygvztocornqkkhk`, Lovable) al nuevo (`jyzvdowflblxmlahlupo`), los recordatorios 48h, día-de y la auto-cancelación dejaron de dispararse. La query `SELECT * FROM cron.job` en el nuevo proyecto devolvía `relation "cron.job" does not exist`.

**Causa raíz:** Las extensiones `pg_cron` y `pg_net` no se habilitan automáticamente en proyectos Supabase nuevos, y los cron jobs registrados en el proyecto viejo no se replican al nuevo. El runbook de migración no incluía este paso.

**Solución aplicada:** Habilitar `CREATE EXTENSION pg_cron` + `pg_net`. Guardar el `service_role_key` en `vault.secrets` con name `service_role_key`. Re-registrar los 3 jobs (`send-appointment-reminders`, `send-day-of-reminders`, `auto-cancel-unconfirmed`) leyendo el secret vía `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')`.

**Lección aprendida:** Toda migración entre proyectos Supabase debe incluir un checklist explícito de: (1) extensiones habilitadas (`pg_cron`, `pg_net`, `vault`), (2) secrets en `vault.secrets`, (3) cron jobs registrados, (4) env vars de Edge Functions (`APP_URL`, OAuth keys, etc.), (5) tabla `webhooks` rellenada. La presencia de tablas y datos no garantiza que el comportamiento operacional esté restaurado.

---

## 2026-04-30 — Reschedule por staff no notificaba al paciente

**Categoría:** backend

**Síntoma:** Cuando admin o doctor reagendaban una cita desde el panel, el paciente no recibía WhatsApp con la nueva fecha. Solo cuando el reagendamiento lo iniciaba el paciente vía `/gestionar` (manage-reschedule) llegaba notificación.

**Causa raíz:** Las EFs `admin-reschedule-appointment` y `doctor-reschedule-appointment` emitían `appointment.rescheduled` + `appointment.status_changed`, pero ningún webhook estaba suscrito a esos events para el flujo de staff. Adicionalmente el payload no incluía `manage_url` (bug previamente identificado).

**Solución aplicada:** Crear nuevo `event_type` dedicado `appointment.rescheduled_by_staff`, encapsulado en helper `_shared/staff-reschedule-webhook.ts`. Eliminar la emisión doble (`rescheduled` + `status_changed`) de las dos EFs de staff — el status no cambia en un reschedule, así que `status_changed` no aplica conceptualmente. `manage-reschedule` (paciente) sigue intacto emitiendo `appointment.rescheduled`.

**Lección aprendida:** Distinguir flujos por actor en el `event_type` desde el inicio (`_by_patient`, `_by_doctor`, `_by_staff`) facilita que n8n suscriba plantillas distintas. Y un evento que no implica cambio de estado (reschedule, sync, etc.) NO debe emitir `appointment.status_changed` — eso hace ruido y confunde a consumidores.

---

## 2026-04-30 — Citas confirmadas se quedaban "confirmed" indefinidamente tras la consulta

**Categoría:** backend

**Síntoma:** Citas con `status = 'confirmed'` y `end_at` ya pasado se mantenían en ese estado para siempre. El evento `appointment.completed` estaba listado en el dropdown de `Webhooks.tsx` pero ningún EF lo emitía.

**Causa raíz:** No existía un cron que transicionara `confirmed → completed`. La transición solo ocurría implícitamente cuando el doctor llenaba el formulario post-consulta, pero muchas citas nunca lo recibían.

**Solución aplicada:** Crear EF `auto-complete-appointments` que cada 15 min busca `status = 'confirmed' AND end_at < now()` y las marca como `completed`, emitiendo `appointment.completed` + `appointment.status_changed`. Registrar el cron en pg_cron con frecuencia `*/15 * * * *`.

**Lección aprendida:** Cualquier estado terminal (cancelled, completed) debe alcanzarse por un camino determinístico — nunca depender de que un humano llene un formulario. Los cron jobs son la red de seguridad para datos que deben transicionar por tiempo, no por acción.

---

## 2026-05-01 — 404 NOT_FOUND al refrescar rutas internas en Vercel (SPA sin rewrite)

**Categoría:** deploy

**Síntoma:** Tras el deploy a Vercel, entrar directamente o refrescar (F5) cualquier ruta interna como `/admin/doctores`, `/doctor/agenda`, `/reserva?token=…`, `/gestionar?token=…` devolvía la página de error default de Vercel con `Code: NOT_FOUND`. La home (`/`) sí cargaba bien.

**Causa raíz:** La app es un SPA con React Router — solo existe `index.html` físicamente. Vercel intentaba servir un archivo en la ruta del request, no lo encontraba y devolvía 404 antes de que React tomara el control. No había `vercel.json` con regla de rewrite.

**Solución aplicada:** Crear `vercel.json` en la raíz del repo con:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

**Lección aprendida:** Toda SPA desplegada en Vercel necesita un rewrite global a `/index.html`. Es parte del setup base, no algo a descubrir tras un bug en producción. Verificar antes del primer deploy a Vercel.

---

## 2026-05-01 — `/login` no forzaba re-autenticación con sesión activa

**Categoría:** frontend / seguridad

**Síntoma:** Si un usuario tenía sesión activa (persistida en localStorage) y otro usuario navegaba a `/login`, la app respetaba la sesión existente y redirigía al home del rol del primer usuario, sin pedir credenciales. Agujero de seguridad en computadoras compartidas.

**Causa raíz:** `Login.tsx` tenía un `useEffect` que detectaba `session && role` y redirigía inmediatamente. Faltaba la semántica de "navegar a /login = quiero ingresar de nuevo".

**Solución aplicada:** En `Login.tsx`, gate el redirect post-login con un flag `readyToRedirect` que solo se enciende después del check inicial. Si en ese check hay sesión activa, llamar a `signOut()` antes de encender el flag. Mientras se procesa el signOut, mostrar el spinner. Toast informativo al terminar: "Sesión cerrada. Ingresa tus credenciales para continuar.".

**Lección aprendida:** La sesión persistida es buena UX para volver a una app, pero la página `/login` debe interpretarse como una intención explícita del usuario de re-autenticar. La persistencia debe respetarse en rutas protegidas, no en la página de login.

---

## 2026-05-01 — Email del doctor desincronizado entre `auth.users` y `public.users`

**Categoría:** backend / datos

**Síntoma:** Tras editar el email de un doctor desde la UI del admin, el doctor no podía iniciar sesión con NINGÚN email. El email nuevo aparecía en la tarjeta del admin pero no funcionaba; el viejo no aparecía en ningún lado pero seguía siendo el válido en `auth.users`. Adicionalmente, algunos emails históricos quedaron con mayúsculas en `public.users` mientras Supabase Auth los normaliza a minúsculas — segunda fuente de desync.

**Causa raíz:** No existía un endpoint que actualizara las dos tablas atómicamente. El admin (o algún flujo de UI) hacía `UPDATE public.users SET email = ...` directo, pero `auth.users` solo se modifica vía `supabase.auth.admin.updateUserById()` (requiere service role). Las dos tablas son fuentes de verdad distintas para el login (auth.users) y para la UI de admin (public.users).

**Solución aplicada:** Nueva EF `update-doctor-credentials` que toma `{doctor_id, email?, password?}` y actualiza atómicamente: (1) pre-check de email duplicado en `public.users`, (2) UPDATE `public.users` con email lowercased + initial_password, (3) `auth.admin.updateUserById()` con email/password, (4) si el paso 3 falla, rollback del paso 2 a los valores anteriores. Email siempre lowercased en input. Nuevo dialog `EditCredentialsDialog` en `Doctores.tsx` que llama esta EF.

**Lección aprendida:** Cuando una entidad tiene presencia en dos tablas (auth + extension), nunca actualizar una sola desde el frontend. Toda mutación debe pasar por una EF que sincronice ambas con rollback. Y los emails se normalizan a minúsculas en escritura — la única manera de garantizar que el lookup posterior siempre matchee, dado que Supabase Auth lo hace internamente.

---

## 2026-05-01 — "Edge Function returned a non-2xx status code" expuesto al admin como toast

**Categoría:** frontend / UX

**Síntoma:** Al crear un doctor con email duplicado, el toast mostraba literalmente "Edge Function returned a non-2xx status code". El admin no entendía qué pasó ni qué hacer. Mismo patrón en cualquier otro error remoto del flujo de creación.

**Causa raíz:** El `FunctionsHttpError` del SDK de Supabase tiene `message` igual a esa string técnica por default. La respuesta real (con `{error, message}` estructurado) vive en `error.context` como `Response` sin parsear. El frontend solo leía `err.message` y lo mostraba directamente.

**Solución aplicada:** Crear helper `src/lib/edge-function-error.ts` con `extractEdgeFunctionError(err)` (clona el `context: Response` y parsea el JSON) y `toastFromEdgeFunctionError(parsed, fallbackTitle)` (mapea códigos a `{title, description}` en español). Refactor de `create-doctor` para devolver siempre `{error: <code>, message: <es>}` con códigos consistentes (`unauthorized`, `forbidden`, `email_taken`, `invalid_email`, `weak_password`, `missing_fields`, `internal_error`). `CreateDoctorDialog` y `EditCredentialsDialog` usan el helper.

Adicionalmente, el helper detecta strings técnicos como `non-2xx`, `TypeError`, `JSON.parse` etc. en el `message` y los reemplaza por un mensaje genérico amigable. Defensa en profundidad: aunque una EF nueva olvide devolver `{error, message}` estructurado, el usuario nunca verá un string técnico.

**Lección aprendida:** Las Edge Functions de FindMed devuelven SIEMPRE shape `{error: <machine_code>, message: <es>}` en respuestas no-2xx. El frontend SIEMPRE pasa los errores por `extractEdgeFunctionError` antes de mostrarlos. Cuando se agregue una nueva EF que devuelve errores al usuario, seguir este patrón.

---

## 2026-05-01 — `doctor_address` legacy en payloads de webhook tras Mejora 2 (multi-consultorio)

**Categoría:** backend

**Síntoma:** Tras Mejora 2, cada cita pertenece a un consultorio específico (`office_id`) con su propia dirección, y `doctors.address` quedó deprecated. Pero los webhooks `appointment.reminder_48h`, `appointment.reminder_day_of` y `appointment.rescheduled_by_staff` (este último recién creado) seguían enviando un campo `doctor_address` en el payload — fuente del campo confusa, podía ser la dirección legacy del doctor o la del office, dependiendo del EF.

**Causa raíz:** Cuando se agregó el campo en cada EF (en momentos distintos) no se unificó el contrato del payload. Algunas EFs ya escribían `office_address` correctamente pero seguían escribiendo también `doctor_address` "por backward compat", duplicando la fuente. El nuevo `staff-reschedule-webhook.ts` ni siquiera incluía la dirección.

**Solución aplicada:** Eliminar `doctor_address` del payload en `send-appointment-reminders` y `send-day-of-reminders` (ya tenían `office_address`). Agregar `officeAddress` al input interface de `staff-reschedule-webhook.ts` y al payload, y pasarlo desde `admin-reschedule-appointment` y `doctor-reschedule-appointment` (ambos ya cargaban `office.address` para el calendar sync). Las 2 ocurrencias restantes en `manage-validate` y `reserve-validate` se preservan (tienen comentario explícito "backward compat for /gestionar markup", son responses HTTP a páginas del paciente, no webhooks).

**Lección aprendida:** Cuando un campo migra de una tabla deprecated a otra (aquí: `doctors.address` → `doctor_offices.address`), buscar TODOS los payloads de webhook con grep antes de cerrar la migración. El frontend puede mantener compatibilidad ambigua, pero los webhooks son contratos hacia sistemas externos (n8n) y deben tener un solo nombre de campo por concepto.

---

## 2026-05-17 — OAuth de calendarios "se desconecta solo" tras un periodo corto

**Categoría:** backend / integración

**Síntoma:** Los calendarios (Google y Outlook) de los doctores quedaban en estado fantasma: la UI mostraba "Conectado" pero las operaciones a la API externa fallaban silenciosamente — eventos no se creaban en el calendario, no se borraban al cancelar, la agenda no mostraba eventos externos. Único workaround: desconectar y rehacer OAuth manualmente. Pasaba con ambos proveedores (descartaba la limitación de 7 días de Google Testing — Microsoft no la tiene). Adicionalmente, el dropdown del calendario seleccionado en `/doctor/configuracion` aparecía vacío al cargar.

**Causa raíz:** Dos bugs separados que componían el síntoma:

1. **Rotación de refresh tokens no persistida (Outlook).** Microsoft Identity Platform rota el `refresh_token` en cada respuesta de `/token` (refresh). El código sólo leía `access_token` y descartaba el `refresh_token` nuevo. Tras X refreshes el token guardado dejaba de ser válido y todas las operaciones devolvían `invalid_grant`. Aplicaba a Outlook por la rotación; aplicaba a Google esporádicamente cuando hay re-consent o rotación condicional.
2. **Sin auto-disconnect en `invalid_grant`.** Cuando el refresh token era permanentemente inválido (revocado, expirado, rotado fuera de sincronía), `getGoogleAccessToken` / `getOutlookAccessToken` devolvían `null` silenciosamente sin tocar la DB. La columna `xxx_calendar_connected` seguía `true` para siempre — la UI mentía y el doctor no sabía que tenía que reconectar.
3. **Implementaciones inline divergentes.** Múltiples Edge Functions (events, list, create-event, update-event, delete-event, manage-cancel, manage-reschedule, reserve-slots, reserve-create, cancel-by-doctor) tenían su propio `fetch` a `oauth2.googleapis.com/token` o `login.microsoftonline.com/.../token` con manejo independiente del error. Arreglar el bug en un solo lugar dejaría las demás vulnerables.
4. **Dropdown vacío.** En `OfficeCalendarConnector.tsx`, el `<Select>` recibía `value=office.google_calendar_id` pero la lista de `<SelectItem>` (`googleCalendars`) se cargaba lazy al abrir el dropdown. Cuando Radix Select recibe un value sin SelectItem correspondiente, el trigger renderiza vacío. La función `resolveCalendarName` que computaba el placeholder dependía del mismo endpoint roto, así que también fallaba silenciosamente.

**Solución aplicada:**

- **Helper `_shared/calendar-tokens.ts` rehecho** para aceptar `{ supabase, office }` (en vez de solo `office`). En cada refresh:
  - Si la respuesta trae `refresh_token` y es distinto del guardado → UPDATE `doctor_offices.{provider}_refresh_token_ref` y actualiza el objeto in-memory para que la siguiente llamada en la misma request use el nuevo token (clave para Microsoft, que invalida el anterior tras grace period).
  - Si la respuesta es 4xx con `error: "invalid_grant"` → marca el office como desconectado (`{provider}_calendar_connected=false, {provider}_calendar_id=null, {provider}_refresh_token_ref=null`). La UI ya no miente.
  - Si la respuesta es 5xx, network error u otro `invalid_client` → log y degrade graceful, NO desconectar (es transitorio).
- **Migración exhaustiva de 13 Edge Functions** al helper compartido: admin-cancel-appointment, admin-create-appointment, admin-reschedule-appointment, cancel-by-doctor, doctor-create-appointment, doctor-office-delete, doctor-reschedule-appointment, google-calendar-{create,delete,events,list,update}-event, manage-cancel, manage-reschedule, outlook-calendar-{create,delete,events,list,update}-event, reserve-create, reserve-slots, _shared/slot-validation.ts. Cero `fetch` directo a `oauth2.googleapis.com/token` o `login.microsoftonline.com/.../token` fuera del helper y de los callbacks OAuth.
- **`OfficeCalendarConnector.tsx`**: `resolveCalendarName` ahora también popula `googleCalendars`/`outlookCalendars` para que el Radix Select encuentre el SelectItem que matchea `value`. El `useEffect` que disparaba la resolución se cambió a depender de `cals.length === 0` (en lugar de `friendlyName === null`) y `<SelectValue>` ahora siempre tiene children (`friendlyName ?? "Calendario conectado"`) como defensa adicional.

**Lección aprendida:**

- Cualquier flujo OAuth que use refresh tokens **debe persistir el `refresh_token` de la respuesta** cada vez, no sólo en el callback inicial. Microsoft rota siempre; Google rota a veces; asumir que el token guardado vive para siempre es un bug latente.
- Cuando un proveedor responde `invalid_grant`, el sistema **debe reflejarlo en la DB** y dejar de mentir en la UI. Mantener el flag `connected=true` mientras todas las operaciones fallan es peor que mostrar "Desconectado": el doctor no sabe que tiene que actuar.
- Lógica de OAuth refresh es exactamente el tipo de código que debe vivir en `_shared/` y no copiarse inline. Cuando una Edge Function nueva necesita refrescar tokens, debe importar el helper — nunca duplicar el `fetch` al endpoint del proveedor.
- Radix Select con `value` sin SelectItem correspondiente renderiza vacío (no muestra el placeholder). Si la lista se carga lazy, hay que pre-poblarla cuando se conoce el value, o pasar children explícitos a `<SelectValue>`.

---

## 2026-05-18 — UI miente sobre estado de calendarios externos por inercia tras Mejora 2

**Categoría:** frontend / datos

**Síntoma:** Cuatro síntomas combinados:
1. La tarjeta del doctor en `/admin/doctores` mostraba una sola fila "Google Calendar: Conectado/No conectado" a nivel doctor, ignorando que post-Mejora 2 cada consultorio tiene su propio estado.
2. Esa fila mentía: decía "No conectado" cuando los calendarios sí estaban conectados y sincronizando correctamente.
3. Al conectar un calendario en un consultorio, los calendarios previamente conectados en OTROS consultorios del mismo doctor aparecían momentáneamente como desconectados antes de volver al estado correcto.
4. El dropdown del calendario seleccionado en `/doctor/configuracion` mostraba a veces el texto genérico "Calendario conectado" en vez del nombre real (ej. "Prueba FindMed"). Solo al abrir el dropdown se veían los nombres reales.

**Causa raíz:**

1. **`doctors.google_calendar_connected` quedó deprecated tras Mejora 2** (estado vive en `doctor_offices`) pero seguía siendo leído por `Doctores.tsx` línea 442. El campo nunca se actualizaba cuando se conectaba un calendario por consultorio, así que se quedó en `false` indefinidamente — lying field. Mismo patrón que ya se había arreglado en `Calendario.tsx` (entrada 2026-04-29) pero olvidado aquí.
2. **`invalidateOffices()` tras OAuth/conexión** invalidaba la query completa `["doctor-offices", doctorId]`. Aunque la query tenía `placeholderData: keepPreviousData`, el refetch causaba a los sibling `OfficeCalendarConnector` re-renderizar sus efectos (incluyendo el `useEffect` que iba a Postgres a leer `refresh_token_ref`), y durante esa ventana corta los otros consultorios se veían "Desconectado" hasta que el refetch resolvía. "Unos minutos" en la práctica era ~segundos, percibidos como largos por el usuario.
3. **El nombre del calendario seleccionado se computaba vía live-lookup al endpoint `{provider}-calendar-list`** cada vez que cargaba la página. Si el endpoint era lento, fallaba o el calendario seleccionado no estaba en `minAccessRole=owner`, el `friendlyName` quedaba `null` y el componente caía al texto genérico "Calendario conectado". Plus el fix anterior pasaba ese texto como children de `<SelectValue>` lo que sobrescribía la auto-derivación de Radix incluso cuando el SelectItem matcheaba el value.

**Solución aplicada:**

1. **Migración `20260518100000_office_calendar_display_name.sql`**: agregar columnas `google_calendar_name TEXT`, `outlook_calendar_name TEXT` a `doctor_offices`. Nullable, sin backfill — offices legacy se backfilean al primer load via lookup vivo que persiste el nombre en DB. Próximos loads leen directo del row.
2. **`doctor-office-update` EF**: aceptar los nuevos campos como parámetros opcionales; al hacer `disconnect_google`/`disconnect_outlook` también limpiar el name (NULL). El auto-disconnect de `_shared/calendar-tokens.ts` también limpia el name.
3. **`OfficeCalendarConnector.tsx`**:
   - El `friendlyName` ahora se deriva directamente de `office.google_calendar_name` / `office.outlook_calendar_name` (props), no de state local que dependía de fetch lazy.
   - `resolveCalendarName` se ejecuta SOLO cuando el name está null (legacy office) y al resolverlo lo persiste a DB via `doctor-office-update` con `setQueryData` optimista.
   - `saveCalendar`, `switchCalendar`, `performDisconnect`, y el post-OAuth `finish()` ya NO llaman `invalidateOffices()`. Usan `patchOfficeCache` (setQueryData) para actualizar SOLO la fila del office tocado. Siblings nunca ven refetch.
4. **`Doctores.tsx` admin card**:
   - Removido `google_calendar_connected` del select de `doctors` (deprecated, lying).
   - Nueva query `["doctor-offices-summary", doctorId]` que lee de `doctor_offices` los consultorios activos con sus flags de Google/Outlook.
   - La fila "Google Calendar" se reemplazó por "Calendarios" con una lista compacta: `<nombre del consultorio>: <Google conectado | Outlook conectado | Sin calendario>` por cada office activo. No expone calendar_id ni email — la gestión rica vive en el diálogo "Consultorios" del admin.

**Lección aprendida:**

- Cuando un campo migra de tabla (aquí `doctors.X` → `doctor_offices.X`), un grep global del nombre del campo no encuentra todos los call sites — hay que enumerar los lugares de la UI que muestran ese concepto y verificarlos uno por uno. El grep que se hizo en la entrada 2026-04-29 cubrió `Calendario.tsx` pero no `Doctores.tsx` porque éste lo leía como parte de un select-with-asterisk semántico (no usaba el nombre como string literal en código adicional).
- Para queries que renderizan listas con sub-componentes con sus propios side effects, **`invalidateQueries` puede causar flashes incluso con `keepPreviousData`** — el refetch dispara la re-evaluación de efectos en hijos. Cuando sabes exactamente qué cambió, usar `setQueryData` (optimistic patch) en lugar de invalidate.
- Si necesitas un valor friendly para mostrar en UI y ese valor viene de una API externa lenta/que puede fallar, **persiste el snapshot en tu propia DB** al momento que el usuario lo elige. No depender del live-lookup en cada page load — es lento, falla y obliga a manejar estados de loading/error que confunden al usuario.

---

## 2026-05-01 — `PAYLOAD_EXAMPLES` en `Webhooks.tsx` desincronizado del payload real

**Categoría:** frontend / docs

**Síntoma:** El UI de Webhooks (`/admin/webhooks`) muestra ejemplos JSON del payload de cada evento, usados como documentación cuando el admin configura un webhook nuevo. Varios ejemplos no reflejaban el payload real que las EFs estaban emitiendo: faltaban campos (office_id, office_name, office_address, manage_url en eventos como reminder_*, status_changed), tenían campos que ya no se emiten (doctor_address legacy en created/cancelled), y `appointment.rescheduled` mostraba un `appointment_id` único cuando el real usa `old_appointment_id` + `new_appointment_id`.

**Causa raíz:** Cuando una EF cambia su payload (agregar campo, renombrar, cambiar shape) no hay un step "actualizar el ejemplo del UI" en el flujo. Los ejemplos se quedaron en una versión de hace varias migraciones.

**Solución aplicada:** Auditar cada evento contra su EF emisora y reescribir `PAYLOAD_EXAMPLES`. Cambios principales: (1) `appointment.created` agregó office_id/name/address, doctor_id, manage_token; (2) `appointment.confirmed` quitó doctor_name (no se emite) y agregó manage_url; (3) `appointment.cancelled_by_admin` extendió con source, previous_status, office_*, end_at, notify_patient/doctor; (4) `appointment.rescheduled` cambió a old_/new_appointment_id; (5) `appointment.rescheduled_by_staff` agregó office_address; (6) reminders 48h/day_of agregaron office_id/name/address y min_confirm_hours_before; (7) `appointment.status_changed` agregó manage_url; (8) `postconsultation.submitted` agregó end_at y symptoms. `appointment.cancelled` legacy y `patient.created` se anotaron con comentarios explicando su estado.

**Lección aprendida:** Cuando se modifica el payload de un webhook, es obligatorio actualizar `PAYLOAD_EXAMPLES` en `Webhooks.tsx` en el mismo PR. Los ejemplos son la fuente de verdad documentada para el admin que configura n8n; si divergen, el admin construye plantillas Whaapy contra campos que no llegan.

---

## 2026-06-04 — Landing pública leía auth y ofrecía "Ir al dashboard" (bypass de login)

**Categoría:** frontend / seguridad

**Síntoma:** La landing pública (`/`) importaba `useAuth` y, si detectaba una sesión activa, cambiaba su CTA de "Iniciar sesión" a "Ir al dashboard" con un link directo a `/admin/calendario` o `/doctor/agenda`. Esto daba acceso directo a rutas autenticadas desde la homepage pública, saltándose por completo la página `/login` — la cual existe precisamente para forzar re-autenticación (ver entrada 2026-05-01 "/login no forzaba re-autenticación"). En una computadora compartida, cualquiera que abriera la raíz con una sesión persistida entraba al panel del usuario anterior con un clic.

**Causa raíz:** Al construir la landing se añadió un "edge case" mal entendido: mostrar "Ir al dashboard" para usuarios autenticados. Eso reintrodujo el mismo agujero que `/login` ya resolvía con su `signOut()` forzado on-mount. La landing, además, dependía del contexto de auth (`useAuth`) cuando debía ser 100% estática e indexable. El bug nació de tratar la conveniencia ("ya está logueado, mándalo directo") como requisito, ignorando que el punto único de entrada autenticado debe ser `/login`.

**Solución aplicada:** Eliminar todo uso de `useAuth` de `Landing.tsx`. El CTA es ahora SIEMPRE "Iniciar sesión" → `/login`, sin ramificar por estado de sesión. La redirección al dashboard para usuarios ya autenticados la sigue manejando exclusivamente `/login` (comportamiento estándar existente, con su `signOut()` forzado intacto). La landing quedó sin dependencias de auth context ni fetch.

**Lección aprendida:** Una página pública NUNCA debe leer el estado de auth para ofrecer atajos a zonas autenticadas. El único punto de entrada a rutas protegidas es `/login`, que centraliza la política de re-autenticación. Si una página pública necesita "saber" si hay sesión para cambiar su CTA, eso es una señal de alerta: probablemente está a punto de bypasear el gate de seguridad. Mantener las páginas públicas estáticas y agnósticas del auth no es solo performance/SEO — es contención del blast radius de seguridad.

---

## 2026-06-04 — Afirmaciones de seguridad falsas/infladas en la landing pública

**Categoría:** frontend / datos

**Síntoma:** La sección "Confianza y seguridad" de `Landing.tsx` publicaba 4 afirmaciones, dos de ellas no sustentadas por la realidad técnica del proyecto:
1. **"Respaldos en la nube — Backups automáticos sobre infraestructura segura y redundante."** FALSO en el plan actual: FindMed corre sobre el plan **Free** de Supabase, que **no incluye backups automáticos** (los backups diarios empiezan en el plan Pro; PITR es add-on pago). Se prometía una capacidad inexistente.
2. **"Alineado con la Ley General de Salud (Capítulo VI Bis, salud digital) y la LFPDPPP."** PARCIAL/inflado: el Aviso de Privacidad (`src/content/legal/privacidad.md`) referencia la LFPDPPP de forma sólida y menciona "las reformas a la Ley General de Salud … en materia de Salud Digital … **en lo que resulte aplicable**" (hedge), pero **nunca cita "Capítulo VI Bis"**. La landing inventó una cita de capítulo específica que el documento legal no hace, y "Alineado" sobreafirmaba respecto del "en lo que resulte aplicable" del aviso.

Las otras dos eran verdaderas: cifrado en tránsito (TLS) + cifrado de credenciales/tokens (el cifrado at-rest de disco de Supabase aplica en todos los planes), y control de acceso por roles (enum `app_role`, tabla `user_roles`, funciones `has_role`/`is_admin_or_superadmin`, RLS en todas las tablas, tokens efímeros para pacientes).

**Causa raíz:** La sección se redactó con lenguaje de marketing genérico de "SaaS médico" sin auditar cada afirmación contra (a) el plan de infraestructura contratado y (b) el texto de los documentos legales del propio repo. Las features de seguridad se asumieron por defecto ("todo SaaS tiene backups y cumple normas") en vez de verificarse.

**Solución aplicada:** (1) Eliminar la card de "Respaldos en la nube" (queda en 3 cards, grid `md:grid-cols-3`) en vez de reformularla a un eufemismo igualmente no verificable como "alta disponibilidad" (el plan Free tampoco la garantiza). (2) Reformular "Cumplimiento normativo" a "Tratamiento de datos conforme a la LFPDPPP y a la reforma de Salud Digital de la Ley General de Salud (2026)", reflejando fielmente lo que dice el Aviso de Privacidad, sin citar capítulos inexistentes. (3) Ajustar las otras dos cards al texto exacto del aviso (TLS + cifrado de credenciales/tokens; roles + RLS + tokens).

**Lección aprendida:** Toda afirmación pública de cumplimiento o capacidad técnica (backups, cifrado, certificaciones, marcos normativos) debe verificarse contra evidencia concreta del repo antes de publicarse: el plan de servicio contratado para capacidades de infraestructura, y los documentos legales (`src/content/legal/*.md`) para los marcos normativos — esos documentos son la fuente de verdad de lo que la empresa realmente afirma. Nunca citar artículos/capítulos de leyes que el aviso de privacidad no cita. Si una capacidad no existe en el plan actual, se quita; no se reformula a un eufemismo que siga siendo falso.

---

## 2026-06-08 — Afirmaciones de cumplimiento normativo sin respaldo de NOMs son riesgo de declaración engañosa

**Categoría:** frontend / datos

**Síntoma:** La card "Cumplimiento normativo" de `Landing.tsx` decía "Tratamiento de datos **conforme a** la LFPDPPP y a la reforma de Salud Digital de la Ley General de Salud (2026)". El verbo "conforme a" (igual que "cumple con" / "alineado con") afirma adecuación total al marco normativo. Esa afirmación no es respaldable hoy: las **Normas Oficiales Mexicanas (NOMs) técnicas** derivadas de la reforma de Salud Digital de la LGS aún no se han publicado. Sin las NOMs que definen los requisitos técnicos concretos, ningún operador puede declarar cumplimiento total — hacerlo es una potencial declaración engañosa frente al usuario y la autoridad.

**Causa raíz:** Al corregir una versión anterior (entrada 2026-06-04) se reformuló la card de "Alineado con … Capítulo VI Bis" a "conforme a", pero "conforme a" sigue siendo un verbo de adecuación. Se subestimó que la reforma de Salud Digital es marco habilitante sin reglamentación técnica vigente; el cumplimiento "total" no es declarable hasta que existan las NOMs.

**Solución aplicada:** Reformular a lenguaje descriptivo de operación, no de adecuación: título "Marco normativo" y texto "FindMed opera dentro del marco mexicano de protección de datos personales (LFPDPPP) y los principios de salud digital de la Ley General de Salud." "Opera dentro del marco" describe el contexto legal sin afirmar cumplimiento total ni certificación, y sin citar fechas del DOF. Las otras dos cards (Datos encriptados, Privacidad del paciente) quedaron intactas.

**Lección aprendida:** En claims normativos públicos, distinguir entre "operar dentro de un marco" (descriptivo, defendible) y "cumplir/conformarse/alinearse con" (afirmación de adecuación, requiere evidencia). Cuando una ley es habilitante pero su reglamentación técnica (NOMs, lineamientos) aún no se publica, NO se puede declarar cumplimiento total — el verbo correcto es "opera dentro de", "respeta los principios de", "en el marco de". Evitar siempre lenguaje de certificación y fechas específicas del DOF en copy de marketing.

---

## 2026-07-01 — Auto-desconexión de calendario sin evidencia durable: root cause imposible de diagnosticar

**Categoría:** backend / integración / observabilidad

**Síntoma:** Dos consultorios perdieron su conexión de Google Calendar (auto-desconexión por `invalid_grant`). Al investigar, la ÚNICA huella era un `console.warn` en los logs de la Edge Function, que rotan a las ~24h. Para cuando alguien revisó, la causa ya no existía y no se pudo determinar el root cause. Segundo hueco: no había timestamp de cuándo se conectó el calendario, así que no se podía medir la vida del token (conexión → caída), lo que bloqueó aún más el diagnóstico.

**Causa raíz:** El auto-disconnect en `_shared/calendar-tokens.ts` (rama `invalid_grant`) solo hacía `console.warn` + el UPDATE que apaga el office. No persistía nada a una tabla. Los logs de aplicación no son un store válido para evidencia forense: rotan. Además, `doctor_offices` no guardaba el momento de conexión (solo el flag `*_calendar_connected`), así que la duración del token era incalculable.

**Solución aplicada:** (1) Nueva tabla durable append-only `calendar_connection_events` (RLS: SELECT admins; inserts por service role) que sobrevive indefinidamente — `office_id`/`doctor_id` como UUID **sin FK** a propósito, para que la evidencia sobreviva incluso si el doctor/office se borra (hard-delete de `doctors` cascadea a `doctor_offices`). Captura `provider`, `event_type` (`auto_disconnect`/`manual_disconnect`), `reason_code`, `http_status`, `provider_response` (jsonb con la respuesta cruda del proveedor), `connected_at` + `lifetime_seconds` (generada), y para desconexiones manuales `actor_user_id`/`actor_role`. (2) Nuevo helper `_shared/connection-events.ts` (`recordAutoDisconnect`/`recordManualDisconnect`), best-effort (nunca lanza ni bloquea). Instrumentado en la rama `invalid_grant` de `calendar-tokens.ts` — un solo punto que cubre las 13+ funciones que refrescan tokens vía el helper compartido. También se loguean las desconexiones manuales en `doctor-office-update`, porque durante el diagnóstico no se pudo distinguir si un office murió por desconexión manual o por Google, y esa ambigüedad costó tiempo real. (3) Columnas `doctor_offices.google_connected_at` / `outlook_connected_at`, estampadas al momento del pick (cuando `*_calendar_connected` pasa a true), solo en la transición no-conectado → conectado para no resetear la vida al cambiar de calendario con el mismo token. Comportamiento existente de conexión/desconexión intacto: solo se AGREGÓ el registro durable.

**Lección aprendida:** Cualquier evento operacional que se necesite investigar después (auto-desconexiones, revocaciones, fallos de integración) debe persistirse a una tabla durable, NO depender de logs de aplicación — los logs rotan y son exactamente lo que falta cuando llega el post-mortem. Cuando un estado se apaga automáticamente por un tercero, registrar: la causa cruda (respuesta del proveedor verbatim), qué entidad, cuándo, y suficiente contexto para medir el ciclo de vida (timestamps de inicio). Y distinguir siempre el actor (auto vs manual) desde el primer evento: la ambigüedad "¿lo apagó el sistema o una persona?" es cara de resolver a posteriori. El punto de instrumentación correcto es el helper compartido `_shared/`, no cada call site — un insert ahí cubre todas las funciones que lo importan.
---

## 2026-10-12 — Service role key y contraseñas reales commiteadas en un repo público + Edge Functions sin auth

**Categoría:** seguridad / deploy

**Síntoma:** Auditoría del repo (público en GitHub) encontró: (1) `scripts/recreate-auth-users.cjs` con la `service_role` key de producción hardcodeada (acceso total a la BD saltando RLS), commiteada el 2026-04-27; (2) `fix_passwords.cjs` y el mismo script con ~52 contraseñas reales en texto plano, incluida la del admin; (3) Edge Functions con `verify_jwt = false` y **sin ninguna auth en código**: `seed-admin` (creaba admin con password conocido), `dispatch-webhook` (firmaba y enviaba a n8n/WhatsApp cualquier payload), `generate-manage-link` (con solo un teléfono entregaba el link /gestionar del paciente), `confirm-appointment` y `send-day-of-reminders`; (4) 12 funciones de Google/Outlook Calendar "verificaban" el JWT solo decodificándolo con `atob` (aceptaban tokens forjados); (5) tokens de paciente, API keys y secrets de webhook generados con `Math.random`.

**Causa raíz:** Scripts operativos escritos con la key pegada "para correrlos rápido" y commiteados sin revisar; asumir que `verify_jwt = false` + "nadie conoce la URL" era suficiente; copiar un helper `decodeJwtPayload` que no verifica firma; no tener un checklist de seguridad por endpoint.

**Solución aplicada:** Borrar los scripts y `seed-admin` del repo. Helpers nuevos `_shared/service-auth.ts` (`isServiceRequest`, compara en tiempo constante contra la key legacy y las `sb_secret_`), `_shared/api-key.ts` (`verifyApiKey`) y `verifyJwtClaims` en `_shared/auth.ts`. `dispatch-webhook`: service key, o JWT de usuario solo para `postconsultation.*` con ownership de la cita y teléfono tomado de la BD. `generate-manage-link`: API key `fm_` o service key. `confirm-appointment`: sin API key solo acepta `manage_token`. Los 4 crons: solo service key. Calendarios: `verifyJwtClaims`. Tokens/secretos con `crypto.getRandomValues`. **Pendiente operativo (no se resuelve con código):** revocar la key filtrada (migrar a llaves `sb_secret_` y revocar el JWT secret legacy), forzar reset de las contraseñas expuestas, `supabase functions delete seed-admin` y redeploy de las funciones tocadas, agregar el header `Authorization: Bearer fm_…` en los nodos de n8n que llaman a `generate-manage-link` / `confirm-appointment`.

**Lección aprendida:** Un secreto que tocó un repo público está comprometido para siempre — borrarlo del árbol (o incluso del historial) no lo des-filtra; lo único que lo neutraliza es rotarlo. Nunca hardcodear llaves ni contraseñas en scripts: leerlas de variables de entorno (`.env.local`, gitignored). Toda función con `verify_jwt = false` debe tener auth explícita en código, y "verificar" un JWT significa verificar su firma, nunca solo decodificarlo. Credenciales y tokens de acceso siempre con CSPRNG.
---

## 2026-10-12 — Doble reserva posible: ninguna barrera en la BD y `reserve-create` sin validar el slot

**Categoría:** backend / schema

**Síntoma:** Dos pacientes (o un paciente con doble clic) podían quedar en el mismo horario del mismo consultorio. `reserve-create` aceptaba cualquier `date`/`slot_start` (pasado, fuera de horario, traslapado) sin validar nada: confiaba en que `reserve-slots` ya había filtrado. `manage-reschedule` solo revisaba disponibilidad semanal, no choques con otras citas ni con el calendario externo.

**Causa raíz:** Toda la protección era check-then-insert en Edge Functions (racy por diseño) y el flujo del paciente ni siquiera hacía el check. `reservation_sessions.used_at` se marcaba *después* del insert y sin condición, así que un doble clic creaba dos citas.

**Solución aplicada:** Migración `20261012120000`: `btree_gist` + `EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&) WHERE status IN ('scheduled','confirmed')` (por doctor, decisión D2) + `CHECK (end_at > start_at)`. Las EFs mapean SQLSTATE `23P01` → HTTP 409 con mensaje amable. `reserve-create` ahora valida fecha/hora, pasado, `doctor_date_overrides`, `checkAvailability` y `validateSlotAvailable`, y reclama la sesión atómicamente (`UPDATE … WHERE used_at IS NULL RETURNING`) *antes* del insert, liberándola si el insert falla. `manage-reschedule` valida igual, inserta la cita nueva **antes** de cancelar la vieja (antes borraba eventos y cancelaba primero: si el insert fallaba el paciente se quedaba sin cita) y extiende `expires_at` del token.

**Lección aprendida:** Las invariantes de negocio que no pueden romperse (no doble reserva) viven en la BD como constraint, no en código de aplicación. Cada endpoint público valida su propia entrada aunque "el frontend ya filtró". Las operaciones "marcar como usado" se hacen con UPDATE condicional y RETURNING, nunca select-then-update.

---

## 2026-10-12 — Outlook nunca bloqueaba horarios para pacientes: variable inexistente dentro de un try/catch silencioso

**Categoría:** backend

**Síntoma:** Consultorios con Outlook conectado ofrecían a pacientes horarios ya ocupados en su calendario de Outlook.

**Causa raíz:** `reserve-slots` usaba `tokenData.access_token` (variable que no existía; la correcta era `accessToken`). El `ReferenceError` caía en un `catch` que solo hacía `console.error`, y el flujo seguía como si no hubiera eventos. Además la ventana del día se construía sin offset (`${date}T00:00:00`, leída como UTC por Postgres), por lo que las citas de 18:00–23:59 CDMX quedaban fuera de la consulta y las de la noche anterior entraban comparadas por minuto-del-día.

**Solución aplicada:** Reescritura del cálculo en `reserve-slots` sobre instantes absolutos (`_shared/mx-time.ts`: `mxDayBoundsMs`, `mxLocalToMs`), misma lista `busy[]` para citas internas y eventos externos, `Prefer: outlook.timezone="UTC"` en Graph.

**Lección aprendida:** Un `catch` que solo loguea convierte bugs de programación en comportamiento silencioso incorrecto. Deno `check` lo habría detectado (TS2304) — correr el type-check de las Edge Functions en CI. Nunca comparar horarios por "minutos del día"; convertir siempre a instantes.

---

## 2026-10-12 — Paciente reagendaba con horarios del consultorio equivocado

**Categoría:** frontend

**Síntoma:** Con doctores de varios consultorios, `/gestionar` mostraba horarios de un consultorio distinto al de la cita original; `manage-reschedule` luego rechazaba o aceptaba contra el consultorio correcto, generando confusión.

**Causa raíz:** `Gestionar.tsx` enviaba `doctor_id` a `reserve-slots` aunque `manage-validate` ya devolvía `office_id`. `reserve-slots` resolvía `doctor_id` al consultorio más antiguo (rama legacy).

**Solución aplicada:** Enviar `office_id`; mostrar nombre y dirección del consultorio; ocultar "Reagendar" en citas completadas o ya pasadas (en sincronía con el rechazo del backend).

**Lección aprendida:** Cuando una EF agrega un campo para multi-consultorio, revisar *todos* los consumidores (buscar `doctor_id:` en el frontend). Las ramas "legacy" de compatibilidad esconden consumidores no migrados; registrar quién las usa y eliminarlas.

---

## 2026-10-12 — Recordatorios de WhatsApp duplicados y crons sin guarda de estado

**Categoría:** backend

**Síntoma:** Pacientes recibían dos recordatorios de 48 h; una segunda ejecución de `send-day-of-reminders` reenviaba a todos los del día; `auto-cancel-unconfirmed` podía cancelar una cita confirmada segundos antes.

**Causa raíz:** Ventana de 47–49 h (2 h) con cron cada hora y sin marcador de "ya enviado". Updates de estado sin `.eq("status", previo)`: lo que el cron seleccionó ya pudo haber cambiado.

**Solución aplicada:** Columnas `reminder_48h_sent_at` / `reminder_day_of_sent_at`; cada cron reclama la fila con `UPDATE … WHERE marker IS NULL RETURNING` antes de enviar; `auto-cancel` y `auto-complete` condicionan el update al estado previo y saltan si no afectó filas. Schedules de pg_cron ahora versionados en la migración (`cron.schedule` con jobname existente lo actualiza in-place) vía `public.invoke_edge_function(slug)`.

**Lección aprendida:** Todo cron debe ser idempotente por construcción: marcador persistente + claim atómico. Toda transición de estado va con guarda del estado previo. Lo que viva solo en la BD de producción (cron jobs) se pierde; va en una migración.
---

## 2026-10-12 — Migración con la URL de producción hardcodeada en la función que usan los crons

**Categoría:** schema / deploy

**Síntoma:** (Detectado antes de aplicarse.) La primera versión de `20261012120000` definía `invoke_edge_function` con `https://jyzvdowflblxmlahlupo.supabase.co/functions/v1/…` literal. Cualquier `supabase start`, rama de preview o proyecto de staging que aplicara las migraciones habría registrado crons que llaman a las funciones de **producción**; mientras `send-day-of-reminders` siga sin guarda en prod, eso dispara WhatsApps reales a pacientes desde un ambiente de pruebas.

**Causa raíz:** Copiar a una migración el comando que se había creado a mano en producción, sin preguntarse en qué otros ambientes corre una migración.

**Solución aplicada:** La URL base vive en Vault (`edge_functions_base_url`). La migración la deriva una sola vez del cron existente (solo existe en prod); en una BD nueva no hay cron previo, no se crea el secret y `invoke_edge_function` es un no-op con `NOTICE`.

**Lección aprendida:** Una migración corre en *todos* los ambientes. Nada específico de un ambiente (URLs, project refs, llaves) va literal en SQL versionado; va en Vault/secrets y el código debe degradar a no-op cuando falta.
---

## 2026-10-12 — Migración editada después de haberse aplicado en producción (drift)

**Categoría:** schema / deploy

**Síntoma:** Producción tenía aplicada `20261012120000` con la restricción **por consultorio** y la URL de producción literal en `invoke_edge_function`, pero el archivo del repo ya decía **por doctor** y URL en Vault. `schema_migrations` la marcaba como aplicada, así que un `db push` nunca habría aplicado los cambios nuevos: repo y base divergían en silencio.

**Causa raíz:** El archivo se modificó (decisión D2) asumiendo que no se había aplicado; mientras tanto alguien corrió el `db push` con la versión anterior. No se verificó `supabase_migrations.schema_migrations` antes de editar.

**Solución aplicada:** Restaurar `20261012120000` byte a byte a la versión aplicada (commit original) y mover D2 + URL en Vault a una migración nueva `20261013000000`, probada en PGlite reproduciendo el orden real (por consultorio → por doctor; crons en prod siguen llamando al mismo proyecto, en ambientes nuevos quedan inertes).

**Lección aprendida:** Una migración commiteada se considera aplicada en algún ambiente: nunca se edita, se agrega otra. Antes de tocar migraciones, consultar `schema_migrations` del ambiente real (`bash scripts/sb.sh db query "select max(version) from supabase_migrations.schema_migrations"`).
---

## 2026-10-12 — Crons en 401 tras desplegar la guarda de service key

**Categoría:** deploy / backend

**Síntoma:** Tras el despliegue completo (~23:08 UTC), la corrida de pg_cron de las 23:15 (auto-cancel y auto-complete) recibió `401 {"error":"Unauthorized"}` de la propia guarda (`isServiceRequest`), no del gateway.

**Causa raíz:** La guarda compara el Bearer contra `SUPABASE_SERVICE_ROLE_KEY` del runtime de las Edge Functions. El cron manda el valor de Vault `service_role_key`, que se había comparado contra la llave que muestra el dashboard/API, **no** contra el env del runtime: no son el mismo valor. Además, la `sb_secret_` obtenida por API venía enmascarada (inservible como credencial: "Invalid API key"). Las pruebas unitarias simulaban el env, así que no podían detectarlo; faltó una prueba real con la credencial del cron antes de desplegar la guarda.

**Solución aplicada:** Credencial dedicada `FINDMED_CRON_SECRET` (secret de funciones + valor de Vault `service_role_key`, aceptada por `isServiceRequest`), `verify_jwt = false` en los 4 crons (validan en código). Verificado con llamada directa (200) antes de cambiar Vault. Efecto colateral bueno: la llave legacy filtrada ya no vive en Vault y los crons no dependen de la rotación de llaves de Supabase.

**Lección aprendida:** Toda guarda nueva sobre un caller automático (cron, webhook) se prueba en el ambiente real con la credencial exacta que ese caller enviará, antes de desplegarla. No asumir que "la service key" del dashboard es igual al env del runtime. Las llaves que una API lista suelen venir enmascaradas.

## 2026-10-12 — Editar una migración que ya estaba aplicada en producción

**Categoría:** base de datos / deploy

**Síntoma:** El import del catálogo de triaje v2 falló con `column "primera_parada" of relation "triage_findmed" does not exist`; `db push` decía "Remote database is up to date".

**Causa raíz:** Se agregaron columnas editando `20261013160000_triage_catalog.sql` asumiendo que no estaba aplicada (el resumen de estado decía "no aplicada"), pero el usuario ya había corrido el deploy. Supabase registra la migración por versión y no vuelve a ejecutar un archivo editado. No se verificó `supabase_migrations.schema_migrations` antes de editar.

**Solución aplicada:** Se restauró la 160000 tal como se aplicó y los cambios v2 fueron a una migración nueva `20261013170000_triage_catalog_v2.sql`.

**Lección aprendida:** Antes de editar una migración "no aplicada", consultar `select version from supabase_migrations.schema_migrations` en producción. Si ya existe la versión, siempre migración nueva.

## 2026-10-13 — Bugs de UI encontrados en el rediseño por módulos

**Categoría:** frontend

**Síntomas y causas:**
- **Por completar**: todos los formularios se renderizaban a la vez con los mismos `id` en los switches; al tocar la etiqueta de un toggle del segundo paciente se cambiaba el del primero. Ahora los ids incluyen el `appointment_id`.
- **Inbox**: el botón de marcar como leída también abría el detalle y disparaba la mutación dos veces.
- **Inbox (admin y doctor)**: faltaban `appointment_rescheduled` y `appointment_cancelled_by_admin` en el mapa de tipos; se mostraba el nombre crudo y había un error de TypeScript.
- **Consultorios**: `UnifiedAvailabilityEditor` y `OfficeManager` usaban la misma query key `["doctor-offices", id]` con columnas distintas; en TanStack v5 el último en montar decide el queryFn y OfficeManager podía pintar consultorios sin dirección, sin duración y con calendario "desconectado". El editor usa ahora `["doctor-offices", id, "availability-editor"]` (mismo prefijo, recibe las mismas invalidaciones).
- **Tipos de Supabase**: un `.select()` armado con `"..." + "..."` pierde el tipado (GenericStringError) y obliga a casts; pasó en `doctor/Agenda.tsx` y `OfficeManager.tsx`.

**Lección aprendida:** una query key = una forma de dato. Si dos componentes leen columnas distintas de la misma tabla, keys distintas con prefijo común. Los `select` de Supabase siempre en un solo literal. Ids de formularios repetidos en listas deben llevar el id de la fila.

## 2026-10-14 — Post-consulta: formulario repetible y acciones indicadas que se perdían

**Categoría:** frontend / datos

**Síntoma:** (Detectado al construir las rutas post-consulta, Etapa 2.) (1) Si el médico enviaba el formulario sin observaciones, la consulta seguía en "Por completar" y podía enviarse otro formulario para la misma cita. (2) Un interruptor encendido sin detalle (p. ej. "Se envió a hospitalización" sin texto) se guardaba como `null`: el equipo nunca se enteraba de que se indicó.

**Causa raíz:** (1) La lista filtraba solo por `appointments.doctor_notes IS NULL`, y `doctor_notes` toma el valor de las observaciones, que pueden ir vacías; no se revisaba si ya existía un `post_consultation_forms` para la cita. (2) El guardado hacía `toggle ? texto || null : null`, mezclando "no indicado" con "indicado sin detalle".

**Solución aplicada:** La lista excluye citas que ya tienen formulario (`post_consultation_forms(id)` en el select). Un interruptor encendido sin texto se guarda como "Sí, sin detalle.". Además, las rutas post-consulta son idempotentes por formulario (`post_consultation_case_links`) y, si llega un segundo formulario de la misma cita, se agrega a los casos activos en lugar de duplicarlos.

**Lección aprendida:** "Pendiente" debe derivarse de la existencia del registro que lo completa, no de un campo opcional que puede quedar vacío. En formularios con interruptor + detalle, el interruptor es el dato; el texto es complemento: nunca convertir "sí, sin detalle" en `null`.

## 2026-10-14 — "Pedir documentos" se reenviaba cuando el paciente reagendaba

**Categoría:** backend

**Síntoma:** Al reagendar desde `/gestionar`, el paciente volvía a recibir la plantilla `pedir_documentos` (póliza + INE).

**Causa raíz:** `manage-reschedule` crea una cita NUEVA y emite `appointment.status_changed` con `new_status = scheduled`, idéntico a una primera reserva; el mapeo de mensajes (antes n8n, ahora `message_route_steps`) manda todos los pasos de "Reservada". Las reagendas del staff no lo provocaban porque mueven la cita en su lugar y solo emiten `appointment.rescheduled_by_staff`.

**Solución aplicada:** Migración `20261014100000`: `message_route_steps.skip_on_reschedule` (true en `pedir_documentos`). `manage-reschedule` marca el payload con `rescheduled_from`; `messaging.ts` (`isRescheduleEvent`) trata como reagenda ese marcador y cualquier `appointment.rescheduled*`, y omite los pasos marcados. Editable en Automatización ("No enviar al reagendar"); `messaging-admin` solo escribe el indicador si se envía, para que una pantalla vieja no lo apague.

**Lección aprendida:** Un evento que significa cosas distintas según su origen (primera reserva vs. reagenda) debe llevar el origen en el payload desde el productor. Al migrar mapeos de n8n, revisar qué productores emiten el mismo `event_type` y con qué intención.

## 2026-10-14 — Calendario externo: solo 50 eventos y sin eventos de día completo

**Categoría:** backend

**Síntoma:** (F13/R23) Se ofrecían o aceptaban horarios ocupados: días con muchos eventos y días con eventos de día completo ("Vacaciones", "Congreso") en Google/Outlook.

**Causa raíz:** `slot-validation.ts` pedía `maxResults=50` / `$top=50` sin paginar y descartaba eventos sin `dateTime` (los de día completo). `day-slots.ts` pedía 250 sin paginar e igualmente ignoraba los de día completo; además las dos reglas divergían (uno respetaba eventos "libres" y el otro no), así que un horario ofrecido al paciente podía rechazarse al reservar.

**Solución aplicada:** `_shared/calendar-busy.ts` compartido por ambos: pagina (`nextPageToken` / `@odata.nextLink`, tope 10 páginas), día completo = bloqueo de todo el día CDMX (aunque esté marcado "libre"), ignora cancelados, rechazados y entradas informativas de Google; lectura incompleta = "no verificado", nunca "verificado libre". `slot-validation` consulta el día CDMX completo y devuelve `external_calendar`.

**Lección aprendida:** Toda lectura de una API paginada debe seguir la paginación o declararse incompleta. La regla que decide qué se ofrece y la que decide qué se acepta deben ser el mismo código.

## 2026-10-14 — Auto-desconexión con un token viejo borraba una conexión recién hecha

**Categoría:** backend / integración

**Síntoma:** La única auto-desconexión registrada en `calendar_connection_events` (1-jul) ocurrió 63 s después de reconectar Google; el consultorio quedó desconectado.

**Causa raíz:** En `calendar-tokens.ts`, ante `invalid_grant` se hacía `UPDATE … WHERE id = office` sin comprobar que el token que falló siguiera siendo el del consultorio. Una petición que cargó la fila antes de una reconexión (o con un token ya rotado) podía apagar la conexión nueva y válida. La persistencia del token rotado tenía el mismo problema (podía pisar una reconexión con otra cuenta).

**Solución aplicada:** Compare-and-swap: ambos UPDATE llevan `.eq(<columna del token>, <token usado>)`. Si no afecta filas, se registra en log y no se desconecta ni se escribe evento.

**Lección aprendida:** Toda escritura que "invalida" un estado a partir de un dato leído antes debe condicionarse a que ese dato no haya cambiado (CAS), sobre todo cuando el usuario puede reconectar mientras otras peticiones siguen en curso.

## 2026-10-14 — Alta de médico a medias sin aviso (create-doctor)

**Categoría:** backend

**Síntoma:** (F11) Si fallaban el rol, las especialidades, los ajustes, el consultorio o el horario, el admin veía "Doctor creado" y el médico quedaba sin consultorio/horario (sin horarios que ofrecer) o sin especialidades (invisible para el triaje). Una lista de especialidades mal formada lanzaba excepción después de crear el usuario.

**Causa raíz:** Pasos sin transacción y errores solo en `console.error`.

**Solución aplicada:** `create-doctor/provision.ts`: todo o nada. Cualquier paso que falle borra lo creado (hijos primero, luego `doctors` y el usuario de Auth) y responde `registration_failed` con el paso que falló; si no se pudo deshacer, `incomplete_registration` con el correo afectado. La entrada se valida antes de crear nada.

**Lección aprendida:** En altas de varios pasos sin transacción, cada paso o se compensa o se reporta; "solo loguear" equivale a mentirle al usuario.

## 2026-10-14 — El agente cerraba la puerta: "no tenemos especialistas en tu zona"

**Categoría:** backend / agente

**Síntoma:** Queja del cliente: el agente de WhatsApp respondía repetidamente que no había especialistas en la zona del paciente, incluso sin haber entendido qué necesitaba, y "quiero una cita" y "busco ortopedista" recibían casi la misma respuesta.

**Causa raíz:** (1) `search_care_options` devolvía `result: "none"` con `no_active_offices` cuando la zona exacta no tenía consultorio, sin decir que en la misma ciudad (u otras) sí había opciones: el modelo solo tenía un "no" para transmitir. (2) El prompt v2.4 preguntaba el seguro antes de entender la necesidad y no prohibía de forma absoluta el "no tenemos médicos"; solo pedía haber buscado antes.

**Solución aplicada:** `search_care_options` ahora busca alternativas cuando no hay resultado (otras zonas de la misma ciudad con opciones, luego otras ciudades vía `citiesWithSpecialty`) y marca `escalate=true` cuando no hay ninguna; `unknown_city` trae las ciudades con opciones. Prompt FINDI v2.5: necesidad primero, gate de búsqueda (necesidad + ciudad), FALLO 7/8 y prohibición explícita; sin alternativas → caso `appointment_help` + `request_handoff`.

**Lección aprendida:** Una herramienta para un agente nunca debe devolver un "no" seco: el resultado vacío tiene que traer lo que sí hay (alternativas) o la instrucción de escalar. Si el único dato que tiene el modelo es negativo, el modelo lo repetirá al paciente.

## 2026-10-14 — Canalización humana sin aviso al equipo: el paciente oía "alguien te atenderá" y nadie se enteraba

**Categoría:** backend / operación

**Síntoma:** Queja #1 del cliente: cuando el agente canalizaba a un paciente con el equipo, nadie recibía alerta, correo ni notificación. En producción había 3 casos en `awaiting_assignment`, uno urgente con 20 h sin que nadie lo tomara.

**Causa raíz:** `_shared/cases.ts` (`openCase` / `requestHandoff`) solo creaba el caso, apagaba la IA y etiquetaba el contacto en WHAAPY. No había ninguna notificación (`notifications` solo tenía tipos de citas), ningún aviso fuera del panel y ningún tiempo máximo: si nadie abría la pantalla Casos, el caso esperaba indefinidamente. El badge del menú era el único indicio y solo contaba `awaiting_assignment`.

**Solución aplicada:** Migración `20261014110000_case_staff_alerts.sql` + `_shared/staff-alerts.ts`. Cada caso nuevo y cada canalización crea al momento una notificación (`case_opened` / `case_handoff`, con `notifications.case_id`) que el panel muestra por Realtime como aviso fijo con “Ver caso”, sonido y notificación del navegador; idempotente por `case_alerts.dedupe_key`. El worker de cada minuto escala los casos que nadie toma dentro de su SLA (urgente 10, alta 30, normal 120 min; `case_overdue`, hasta 3 re-avisos) y envía la plantilla `alerta_caso_findmed` a los números de guardia (`staff_alert_recipients`), registrando cada envío en `message_deliveries` (`source = 'staff_alert'`) con sus recibos. Si la plantilla falta o WHAAPY falla, el envío queda fallido con motivo y aparece en Inicio; el aviso del panel nunca depende del WhatsApp.

**Lección aprendida:** Toda promesa que el sistema le hace a una persona ("alguien del equipo te atenderá") necesita un responsable notificado, un tiempo máximo y una escalación cuando el tiempo se cumple. Registrar un caso no es avisar: si el único lugar donde aparece es una pantalla que alguien tiene que abrir, la promesa no se cumple. Además: los regex de Postgres no aceptan repeticiones mayores a 255 (`{1,512}` falla al crear la tabla); el largo va en un `char_length` aparte.

## 2026-10-14 — State de OAuth sin firma y redirección abierta en la conexión de calendarios

**Categoría:** seguridad / backend

**Síntoma:** Hallazgo N12: el parámetro `state` de `google/outlook-calendar-auth` era JSON en base64 sin firma, y los callbacks redirigían al origen que viniera dentro.

**Causa raíz:** El `state` se trataba como dato confiable. Cualquiera podía armar un `state` con el `office_id` de otro consultorio (conectar un calendario ajeno) o con un origen arbitrario (redirección abierta tras el consentimiento de Google/Microsoft).

**Solución aplicada:** `_shared/oauth-state.ts`: `state` = payload base64url + HMAC-SHA256 con clave derivada de `getServiceKey()` (contexto `findmed-oauth-state-v1`), nonce, expiración de 15 min, comparación en tiempo constante y proveedor dentro de la firma. Los callbacks verifican antes de tocar la base y solo redirigen a orígenes permitidos (`app.findmed.com.mx`, localhost, el de `APP_URL` y `OAUTH_ALLOWED_ORIGINS` opcional); cualquier otro cae a `APP_URL`. Las cuatro funciones se despliegan juntas.

**Lección aprendida:** Todo lo que viaja por el navegador y vuelve al servidor (state, redirect, return_to) es entrada del usuario: se firma o se valida contra una lista cerrada, nunca se usa tal cual.

## 2026-10-14 — Contraseña fija de "Webhooks" y "API keys" dentro del bundle

**Categoría:** seguridad / frontend

**Síntoma:** Hallazgo N11: `PasswordGate` comparaba contra una contraseña literal que cualquiera podía leer en el JavaScript publicado.

**Causa raíz:** Una "protección" del lado del cliente con un secreto compartido incluido en el código.

**Solución aplicada:** `PasswordGate` re-autentica al admin con la contraseña de su propia cuenta (`supabase.auth.signInWithPassword`) y desbloquea 30 min por usuario en `sessionStorage` (`src/lib/settings-unlock.ts`). El bundle ya no contiene la contraseña; la anterior sigue en el historial público del repo y no debe usarse en ningún otro lugar.

**Lección aprendida:** Un secreto en el frontend no es un secreto. Las confirmaciones sensibles se apoyan en la identidad del usuario, no en una clave compartida.

## 2026-10-14 — Páginas del paciente en la hora del navegador y calendario recorrido un día

**Categoría:** frontend / fechas

**Síntoma:** Hallazgo N19: `/reserva` y `/gestionar` formateaban con `format(new Date(...))`; un paciente fuera de CDMX (o con el teléfono en otra zona) veía otra hora, y el selector de fecha marcaba como "hoy" el día de su zona: bloqueaba el día vigente en CDMX o permitía uno ya pasado.

**Causa raíz:** Fechas de negocio formateadas en la zona del dispositivo y "hoy" calculado con el reloj local.

**Solución aplicada:** `formatMx` en todos los textos; helpers `mexicoTodayYmd`, `mexicoTodayPickerDate`, `isBeforeMexicoToday` y `pickerDateToYmd` en `src/lib/timezone.ts`, con pruebas que simulan navegadores en Madrid, Honolulu y Tokio; leyenda "Horarios en hora del centro de México".

**Lección aprendida:** En páginas públicas el dispositivo puede estar en cualquier zona: toda fecha de negocio se formatea y se compara en `America/Mexico_City`, incluido el "hoy" de los calendarios.

## 2026-10-14 — La lista de la Agenda no se refrescaba tras crear, cancelar o reagendar

**Categoría:** frontend / react-query

**Síntoma:** En `/admin/agenda?vista=lista` la cita creada, cancelada o reagendada desde los diálogos no cambiaba hasta recargar la página.

**Causa raíz:** Los diálogos solo invalidaban las llaves del calendario; la lista usa otra llave (`admin-reservas-appointments`).

**Solución aplicada:** `src/lib/admin-appointment-queries.ts` (`invalidateAdminAppointmentViews`) invalida por prefijo calendario, lista, eventos externos, detalle e Inicio; lo usan todos los `onSuccess` que cambian citas, incluido el borrado de consultorio en `OfficeManager`.

**Lección aprendida:** Cuando la misma entidad se pinta en varias vistas, la invalidación vive en un solo helper con todos los prefijos; no se repite a mano en cada diálogo.

## 2026-10-13 — Revisión visual: fechas crudas en notificaciones, indicadores que se contradicen y textos sin traducir

**Categoría:** frontend / backend

**Síntoma:** (1) El Inbox mostraba "Paciente - 2026-10-14T16:00:00+00:00" (`admin-cancel-appointment`, `admin-reschedule-appointment`, `admin-create-appointment`); `cancel-by-doctor` y `auto-cancel-unconfirmed` usaban `start_at.split("T")[0]`, que es la fecha **UTC**: una cita a las 19:00 CDMX aparecía con el día siguiente. (2) Agente IA: "Errores · 24 h" con un número > 0 y la leyenda "Sin fallas del agente"; en Conexiones, "33 llamadas en 24 h" con ✗ rojo (el ícono medía errores, el texto el volumen). (3) Bitácora con estados y eventos en inglés crudo ("· delivered", "tags added"). (4) "Dr. Dra. Mariana…" en la notificación post-consulta. (5) "1 desconectados", "8 webhooks" fijo en el texto. (6) En `/gestionar` una cita por confirmar se pintaba en verde con ✓ como si estuviera confirmada. (7) El calendario del paciente con `aria-label` "Go to previous month" pese a `locale={es}`.

**Causa raíz:** Textos armados interpolando el dato crudo (ISO, `event_type`, `status`) en vez de pasar por las etiquetas ya existentes; cada pantalla con su propia copia de etiquetas (Casos tenía las de eventos de caso, la bitácora no). Indicadores donde el ícono y el texto describen hechos distintos. Plurales y conteos escritos a mano. En react-day-picker v8 el `locale` de date-fns solo traduce meses y días; las etiquetas ARIA van en `labels`.

**Solución aplicada:** `formatMxLongDateTime` en `_shared/mx-time.ts` ("miércoles 14 de octubre, 10:00", hora CDMX) en todas las funciones que escriben `notifications` con la fecha de la cita (incluida `_shared/appointment-actions.ts`). Etiquetas de eventos de caso movidas a `src/lib/case-labels.ts` (`caseEventLabel`) y usadas en Casos y Agente IA; estados de envío con `DELIVERY_STATUS`. La leyenda de cada indicador enumera lo que cuenta su número, y el texto de cada fila dice lo mismo que su ícono (el volumen pasa al detalle). `src/lib/plural.ts`, conteo real de webhooks de n8n pausados, estado de la cita en `/gestionar` con `APPOINTMENT_STATUS` (ámbar "Por confirmar", verde solo confirmada), `CALENDAR_LABELS_ES` para el calendario, nombre del médico sin anteponer "Dr.".

**Lección aprendida:** Nunca interpolar un valor de máquina (ISO, enum, `event_type`) en texto para personas: siempre por el helper de formato o el mapa de etiquetas compartido, y "fecha" de una cita nunca se obtiene cortando el ISO UTC. En un indicador, el ícono, el tono y la leyenda deben describir el mismo hecho. Los nombres de médicos ya traen su título.

## 2026-10-14 — Catálogo de triaje editable: riesgos detectados antes de publicarlo

**Categoría:** deploy / datos / frontend

**Síntoma:** (Detectado al construir Catálogos → Triaje, antes de desplegar.) (1) El motor (`_shared/triage.ts`) ahora filtra `is_active = true`; si `findmed-mcp` se desplegara antes de aplicar la migración `20261014150000`, la columna no existiría y `suggest_specialty` devolvería `temporarily_unavailable` en todas las consultas del agente. (2) `scripts/import-triage.mjs` hace `DELETE` + `INSERT` de toda la tabla: una recarga borraría en silencio las ediciones, validaciones y condiciones desactivadas desde el panel, y dejaría huérfano el historial (`triage_changes`). (3) Un `Popover` con lista desplazable dentro de un `Sheet`/`Dialog` modal no recibe la rueda del mouse (el bloqueo de scroll del diálogo no incluye el contenido en portal).

**Causa raíz:** (1) Código que lee una columna nueva desplegado de forma independiente de la migración que la crea. (2) El script se diseñó cuando el archivo externo era la única fuente de verdad; con el panel, la fuente de verdad pasa a ser la base de producción. (3) Comportamiento de `react-remove-scroll` en Radix.

**Solución aplicada:** (1) Orden de despliegue documentado: migración primero, después `triage-admin` y `findmed-mcp`. (2) Advertencia en el encabezado del script y en CLAUDE.md: solo para recargas completas acordadas con el equipo clínico; el día a día va por el panel. (3) `KeywordPicker` usa `<Popover modal>`.

**Lección aprendida:** Cuando el código empieza a filtrar o leer una columna nueva, la migración se aplica antes de desplegar ese código (y se dice explícitamente en los pasos de despliegue). Cuando un dato pasa a editarse desde la app, todo proceso que lo reemplaza en bloque (imports, seeds) deja de ser seguro y debe marcarse como tal. Listas desplazables en portal dentro de un modal: `Popover modal`.

## 2026-10-14 — "No tengo médicos en Chimalhuacán, te canalizo": la búsqueda no sabía qué está cerca

**Categoría:** backend / agente / datos

**Síntoma:** Queja del cliente: un paciente de Chimalhuacán (o Neza, Coyoacán, Interlomas…) recibía "no tengo médicos ahí, te canalizo con alguien" y el equipo volvía a hacer el trabajo manual, aunque había consultorios agendables a 20–30 km (Roma, Naucalpan).

**Causa raíz:** `search_care_options` solo entendía nombres del catálogo. Un municipio que no es zona del catálogo era `unknown_zone`/`unknown_city`; las alternativas eran "otras zonas de la misma ciudad" (Chimalhuacán está en Estado de México, cuya única zona con consultorio era Naucalpan) u "otras ciudades", sin ninguna noción de distancia, y nada cruzaba CDMX ↔ Estado de México aunque sean una sola zona metropolitana. Además el catálogo no tiene coordenadas, 13 consultorios de CDMX no tienen zona y 4 zonas son direcciones ("Norte", "Sur", "Poniente", "Centro Poniente"), no lugares; y hay zonas asignadas a la ciudad equivocada (Huixquilucan y Satélite cuelgan de "Ciudad de México").

**Solución aplicada:** Migración `20261014140000`: `latitude`/`longitude` en `zones` y `cities` (sembradas para las de producción que se pueden ubicar con confianza; las direcciones y "Estado de México" quedan vacías a propósito) y tabla `geo_cache`. `_shared/mx-places.ts` (nomenclátor local: 16 alcaldías, 30 municipios del área metropolitana y valle de Toluca, ~40 colonias, ciudades), `_shared/geo.ts` (Haversine; geocodificador Nominatim opcional con caché, 3 s, solo México), `resolveSearchOrigin` + `searchNearbyCareOptions` en `care-search.ts` (ordena por distancia en cualquier ciudad, radio 60 km; consultorio sin coordenadas de zona usa las de su ciudad y va después de los precisos) y `nextAvailableSlots` en `day-slots.ts`. `search_care_options` devuelve las opciones más cercanas con `distance_km`, `next_slots` y `nearest=true` + `note`; fuera del radio, la ciudad con red más cercana con su distancia; `escalate` solo si no hay nada. FINDI v2.6 presenta esas opciones y solo pasa a una persona si las rechaza todas o la pide. Coordenadas editables en Catálogos → Zonas/Ciudades con "Ver en mapa" e indicador "sin coordenadas". Al probar la migración apareció otro error: un `CHECK ((lat IS NULL AND lon IS NULL) OR (lat BETWEEN … AND lon BETWEEN …))` **acepta** latitud sin longitud, porque `NULL BETWEEN …` es NULL y un CHECK que da NULL pasa; se agregó `IS NOT NULL` explícito.

**Lección aprendida:** Una búsqueda por ubicación necesita geografía, no solo nombres: los pacientes dicen el lugar donde viven, no la zona comercial del catálogo. Las alternativas deben ordenarse por cercanía real y cruzar los límites administrativos que el paciente no percibe (CDMX/Edomex). Y en SQL, toda restricción con columnas anulables debe probarse con el caso "una sí, otra no": un CHECK que evalúa a NULL no rechaza nada.

## 2026-10-14 — Deuda de compilación invisible: 138 errores de `deno check` y 24 de lint con el build en verde

**Categoría:** deploy / calidad

**Síntoma:** (Auditoría de construcción.) `npm run build` y `tsc` pasaban, pero `deno check` de las Edge Functions daba 138 errores en 17 archivos y `eslint .` 24 errores. El bundle del frontend era un solo archivo de 1.47 MB (411 kB gzip) que se descargaba completo incluso para abrir `/privacidad`.

**Causa raíz:** (1) Nadie corre `deno check` sobre `supabase/functions`: el deploy de Supabase empaqueta sin type-check, así que los errores no bloquean nada. Casi todos venían de `.select("a, " + "b")` (y de la constante `OFFICE_SELECT` armada con `+`) en 11 funciones: la concatenación vuelve el tipo de la fila `GenericStringError` y cada acceso a `office.google_calendar_id` era un error de tipos (el mismo patrón que ERRORES.md 2026-10-13 ya había visto en el frontend). Los crons hacían `appt.patients as {…}` sobre un tipo inferido como arreglo, y `update-doctor-credentials` encadenaba `.catch` a un builder que solo es `PromiseLike`. (2) `eslint .` revisaba `entrega.local/demo/.vite` (un build ajeno) y los componentes generados de shadcn. (3) `App.tsx` importaba todas las páginas de forma estática.

**Solución aplicada:** Selects en un solo literal (sin cambiar columnas), `as unknown as` en los embebidos de los crons, `try/await` en el rollback de credenciales, tipos mínimos para las respuestas de Google/Graph; `deno check --no-lock --node-modules-dir=none supabase/functions` queda en 0. ESLint ignora `*.local/` y apaga `no-empty-object-type` solo en `src/components/ui/`; `tailwind.config.ts` usa `import`; lint queda en 0 errores. Code-splitting por ruta con `lazyWithReload` + `Suspense` ("Cargando…") y chunks de vendors: carga inicial ~520 kB (≈160 kB gzip) y ningún chunk > 500 kB. `lazyWithReload` recarga una vez si un chunk ya no existe: tras un deploy en Vercel el rewrite `/(.*) → /index.html` responde HTML a un `.js` viejo y el import dinámico falla. `config.toml` declara `verify_jwt` de las 49 funciones (coincide con `functions list`).

**Lección aprendida:** "Compila" no significa nada si la herramienta que compila no es la que corre en producción: las Edge Functions solo se verifican con `deno check`, y va en la lista de verificación de cada cambio (CLAUDE.md regla 8). Con code-splitting en un SPA con rewrite global, todo import dinámico necesita estrategia para chunks borrados por un deploy nuevo.

## 2026-10-14 — RLS por fila sin límite por columna: el doctor podía reescribir su cita y leer refresh tokens

**Categoría:** seguridad / schema

**Síntoma:** (Auditoría de seguridad, N13.) Con su sesión normal y la consola del navegador, un doctor podía: cambiar `start_at`, `status`, `cancel_reason` o los marcadores de los crons de cualquier cita suya (la política "Doctor can update own appointment notes" era `FOR UPDATE` sin límite de columnas); reactivarse o des-borrarse (`doctors.is_active` / `is_deleted`); leer los refresh tokens de Google/Outlook de sus consultorios (el panel los leía solo para saber si existían) e insertar, editar o borrar físicamente `doctor_offices`; insertar notificaciones para admins de cualquier tipo (incluido `case_handoff`, que suena como alerta) y formularios post-consulta de citas de otro doctor. Un admin podía otorgarse `superadmin` desde la consola. Con la publishable key, `/rpc/is_admin_or_superadmin` y `/rpc/get_doctor_id_for_user` respondían para cualquier UUID (oráculo de roles). Además el registro público de Auth está abierto (`disable_signup=false`), así que cualquiera puede obtener un JWT `authenticated`.

**Causa raíz:** RLS decide **qué filas**, no **qué columnas**. Las políticas `FOR UPDATE`/`FOR ALL` "de lo propio" se escribieron pensando en el uso de la pantalla (notas), no en lo que permite PostgREST. Los grants por defecto de Supabase (`ALL` a `anon` y `authenticated`) quedaron intactos y las funciones de rol `SECURITY DEFINER` eran ejecutables por `anon`.

**Solución aplicada:** Migración `20261014160000_security_hardening.sql` (probada en `supabase/tests/security-hardening_test.ts`, PGlite con `SET ROLE`): `anon` sin privilegios en tablas de public (también por defecto para tablas futuras); `authenticated` sin `TRUNCATE`; funciones de rol solo para `authenticated`/`service_role` y las 3 políticas `TO public` pasan a `authenticated`; `users`/`user_roles` y `doctor_offices` sin escrituras desde el navegador; `SELECT` por columna en `doctor_offices`/`doctors` sin los refresh tokens, con columnas generadas `google_token_stored`/`outlook_token_stored` para el panel (`OfficeCalendarConnector`); triggers `guard_client_appointment_update` (no admin: solo notas y completar) y `guard_client_doctor_update` (no admin: nombre y teléfono); `notifications` solo `is_read` editable y el doctor solo inserta `postconsultation_submitted` de citas suyas; formularios post-consulta solo de citas propias y en estado inicial. Las Edge Functions (service role) no cambian.

**Lección aprendida:** Toda política `FOR UPDATE`/`FOR ALL` para un rol no-admin necesita una guarda de columnas (trigger o grant por columna); revisarla preguntando "¿qué puede hacer este rol con PostgREST?", no "¿qué hace la pantalla?". Credenciales (refresh tokens, secrets) nunca en columnas legibles por `authenticated`: exponer un booleano de presencia. Una columna nueva en `doctor_offices` o `doctors` necesita `GRANT SELECT (columna) TO authenticated`. Con el registro público abierto, `authenticated` ≠ "usuario de FindMed".

## 2026-10-14 — Sin cabeceras de seguridad en Vercel y dependencias con vulnerabilidades conocidas

**Categoría:** seguridad / deploy

**Síntoma:** (Auditoría de seguridad.) `vercel.json` no enviaba ninguna cabecera de seguridad: el panel podía cargarse dentro de un iframe ajeno (clickjacking) y no había `nosniff` ni `Referrer-Policy` explícita, aunque `/reserva` y `/gestionar` llevan el token del paciente en la URL. `npm audit --omit=dev` reportaba 16 altas, entre ellas `react-router-dom` 6.30.1 (redirecciones abiertas), `lodash` 4.17.21 y `ws`.

**Causa raíz:** El proyecto nació en Lovable (que ponía sus propias cabeceras) y al migrar a Vercel nadie revisó las respuestas HTTP; las dependencias no se auditaban.

**Solución aplicada:** `vercel.json`: `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` solo para capacidades que nadie usa (micrófono, cámara y portapapeles quedan libres para el iframe de WHAAPY) y una CSP completa en modo **Report-Only** (Supabase https/wss, Google Fonts, `frame-src app.whaapy.com`) para observar antes de aplicarla. `npm audit fix` sin `--force` (solo lockfile, rangos semver): react-router-dom 6.30.6, lodash 4.18.1, ws 8.22.0, nanoid 3.3.20, postcss 8.5.30. Quedan tailwind 3 (herramienta de build), react-router 6 moderado (requiere v7) y vitest (solo dev), que exigen saltos mayores.

**Lección aprendida:** Al cambiar de hosting se revisan las cabeceras de respuesta igual que las variables de entorno. Una CSP nueva se publica primero en Report-Only; `frame-ancestors`, `nosniff` y `Referrer-Policy` se pueden aplicar de inmediato porque no bloquean recursos propios.

## 2026-10-14 — Auditoría de lógica de negocio: mensajes que WhatsApp iba a rechazar, citas reagendadas que se autocancelaban y eventos fantasma en el calendario

**Categoría:** backend / datos

**Síntoma:** (Auditoría de lógica e integridad, sin incidentes reportados todavía porque desde el corte del 13-oct no se ha creado ninguna cita.) (1) De 9 consultorios agendables sin dirección y 1 con saltos de línea en la dirección: todos los recordatorios de 48 h y del día, y las reagendas del staff, de esos consultorios iban a fallar (`missing_value_office_address`, o rechazo de Meta por saltos de línea en la variable). (2) Con "Avisar al paciente por WhatsApp" apagado al crear la cita, el worker igual enviaba la confirmación. (3) `auto-cancel-unconfirmed` no borraba el evento de Google/Outlook (6 citas autocanceladas en producción conservan su `google_event_id`): el médico veía una consulta inexistente y, como los eventos propios de FindMed contaban como "ocupado", ese horario quedaba bloqueado para otros pacientes. Por la misma regla, mover una cita 30 min chocaba con su propio evento. (4) Una reagenda del staff dejaba puesto `reminder_48h_sent_at`: el paciente no recibía el recordatorio de la fecha nueva, no confirmaba y la cita se autocancelaba; mover una cita `scheduled` a menos de 24 h la autocancelaba en ≤ 15 min ("no confirmó a tiempo"). Además se podía reagendar o cancelar una cita **completada** y los UPDATE de admin/doctor no tenían guarda de estado. (5) `manage-reschedule` con doble clic o dos pestañas creaba dos citas vivas; un enlace viejo (p. ej. el de la autocancelación) podía volver a reagendar la cita original. (6) `doctor-office-delete` borraba las sesiones de reserva con un solo DELETE que fallaba por FK (`appointments.created_from_session_id`) y no borraba ninguna (5 sesiones siguen en consultorios borrados); 7 consultorios borrados conservan disponibilidad semanal, así que `reserve-create` y `manage-reschedule` (que no revisaban si el consultorio sigue activo) podían agendar ahí. (7) En Casos, elegir "Asignado" o "Esperando…" sin tomar el caso lo sacaba de la cola del SLA sin dueño (ya no alertaba). (8) Los crons de recordatorio marcaban "enviado" antes de despachar y `fetch` no lanza en 5xx: un despacho fallido perdía el recordatorio. (9) Ninguna llamada a Google/Microsoft tenía timeout.

**Causa raíz:** Variables de plantilla tomadas crudas de la base; banderas del payload (`notify_patient`) que n8n interpretaba y el worker no; el camino de cancelación automática no usaba el helper `calendar-sync`; los movimientos de staff solo cambiaban `start_at`/`end_at` sin pensar en el estado derivado (marcadores, ventana de confirmación, enlaces); "reclamar" la reagenda del paciente no era atómico; validaciones que confiaban en que la lista de horarios ya había filtrado.

**Solución aplicada:** `messaging.ts`: `templateText` (colapsa espacios/saltos, vacío = faltante), dirección → nombre del consultorio como respaldo, `notify_patient=false` → `skipped`. `calendar-busy.ts`: `eventId` + `withoutFindMedEvents` (los eventos de citas de FindMed, de cualquier estado, no cuentan como ocupado; las citas vivas ya bloquean desde la tabla), usado por `day-slots` y `slot-validation`. `auto-cancel` borra los eventos con `deleteAppointmentEvents` y no aborta la corrida si falla el token. `_shared/staff-reschedule.ts` (`moveAppointment`): solo `scheduled/confirmed`, UPDATE con guarda de estado, limpia marcadores, `scheduled` a < 48 h → `confirmed` (misma regla que la reserva), extiende los enlaces vigentes a la nueva hora de fin; lo usan admin y doctor. Cancelar una consulta completada → 409; UPDATE con guarda en admin-cancel, cancel-by-doctor y doctor-office-delete. `repointManageTokens`: la reagenda del paciente mueve todos los enlaces de la cita vieja con compare-and-swap; el perdedor borra su cita nueva y responde 409. `reserve-create`/`manage-reschedule`/`computeDaySlots` rechazan consultorios inactivos/borrados o médicos inactivos. `doctor-office-delete` borra solo sesiones sin usar. `applyStaffAction`: cambiar a estados de trabajo exige dueño (`take_first`); volver a "Sin asignar" libera al dueño y reinicia el SLA. `releaseReminderClaim` libera el marcador si el despacho falla (el outbox deduplica). `_shared/http-timeout.ts` (10 s) en tokens, lecturas, borrados y creación de eventos. Pruebas: `supabase/tests/business-logic-audit_test.ts`.

**Lección aprendida:** Toda transición que mueve una cita debe recalcular lo que depende de la fecha (marcadores de cron, ventana de confirmación, vigencia de enlaces) y llevar guarda del estado leído. Un evento que FindMed escribe en un sistema externo no puede volver como "dato externo" que bloquea a FindMed. Las variables de un mensaje se sanean donde se arma el mensaje, no donde se capturan. "Marcar como enviado" antes de despachar exige liberar la marca cuando el despacho falla.

## 2026-10-14 — QA de navegación, ventanas y robustez en navegador (recorrido automático con la demo)

**Categoría:** frontend

**Síntoma:** Recorrido automático (`entrega.local/demo/qa-sweep.mjs`, Chrome real sobre la demo con datos ficticios) por todas las rutas × roles × 1440/1280/390 px, ventanas, fallas simuladas y zonas horarias. Bugs reales:
1. **Destello de otro rol**: un doctor que abría `/admin/*` (o un admin `/doctor/*`) veía el panel ajeno y disparaba sus consultas antes de ser redirigido.
2. **Móvil**: Inicio (admin y doctor) y Automatización eran más anchos que la pantalla (el viewport crecía a 465–516 px: todo se veía reducido y el engrane del perfil quedaba fuera de la pantalla); la barra lateral (Sheet) no se cerraba al elegir un módulo y no tenía título accesible (error de Radix en consola).
3. **Lecturas fallidas sin aviso**: con la consulta principal fallando, Agenda, Doctores, Automatización, Catálogos y las vistas del doctor se veían vacías ("no hay…") y los Inicio quedaban con skeletons para siempre.
4. **Paciente**: `/gestionar` ofrecía "Cancelar cita" en una consulta ya atendida o pasada (409); una respuesta no-2xx sin `error` (p. ej. 503 de la plataforma) se tomaba como datos válidos y pintaba una cita/reserva vacía; los errores decían "Token inválido" / "No se proporcionó un token"; un fallo al pedir horarios se mostraba como "No hay horarios disponibles".
5. **Avisos y deep links**: el aviso de caso ("Ver caso") no se podía pulsar con una ventana modal abierta (Radix pone `pointer-events:none` en el body); `/admin/casos?caso=<id>` con un id inexistente no avisaba ni limpiaba la URL.
6. **Acciones**: el detalle de cita del admin ofrecía cancelar/reagendar citas completadas; el selector de estado de Casos ofrecía "Asignado/Esperando…" sin dueño (409 `take_first`); sin red los toasts decían "Failed to send a request to the Edge Function"/"Failed to fetch" y los errores de la base salían en inglés ("duplicate key value violates…"); el doctor veía "Error al completar la cita" sin el motivo de la guarda `guard_client_appointment_update`.
7. **"Nueva cita" con la agenda filtrada por consultorio** (admin y doctor): el consultorio preseleccionado se borraba al abrir porque el efecto veía la lista de consultorios vacía mientras cargaba.
8. **Zona horaria**: Inbox/notificaciones (hora y agrupación "Hoy/Ayer"), bitácoras (Automatización, Agente IA, Alertas, Webhooks, API Keys), Casos (fechas y "Vence"), origen post-consulta y reembolsos se formateaban en la zona del navegador (Cancún −5, Madrid…), distinta de la del resto de la app.
9. Sin `ErrorBoundary`: cualquier error de render (o un chunk que no carga dos veces) dejaba la pantalla en blanco.

**Causa raíz:** (1) `useAuth` marca `loading=false` en `INITIAL_SESSION` y lee el rol después; `ProtectedRoute` trataba `role=null` como "permitido". (2) Grids sin columna base (`grid lg:grid-cols-3`): las pistas implícitas no bajan del min-content; el Sheet de shadcn no se cierra solo al navegar. (3) Cada vista asumía que la lectura sale bien; `isLoading || !data` deja skeletons si hay error. (4) Se leía `data.error` sin mirar `res.ok` y se ofrecía cancelar con solo `status !== "cancelled"`. (5) El Toaster de sonner hereda `pointer-events:none`; el hook del deep link solo contemplaba el caso feliz. (6) Botones condicionados solo a `cancelled`; `err.message` del SDK/Postgres directo al toast. (7) `const { data: offices = [] }` + efecto que limpia la selección si no está en la lista. (8) `format(parseISO(…))` de date-fns usa la zona del navegador.

**Solución aplicada:** `ProtectedRoute` espera el rol (spinner) y, si no llega en 10 s, muestra "No pudimos cargar tu perfil" en vez de un panel. `grid-cols-1` en los grids de Inicio y Automatización; `AppShell` cierra la barra lateral móvil al tocar un módulo o cambiar de ruta y le pone título accesible (sin tocar `ui/`). `src/lib/query-client.ts`: aviso global en español, fijo hasta que la lectura se recupere, cuando una lectura falla sin datos (no en refrescos con datos; `meta.silentError` para las que avisan solas); `LoadError` con "Reintentar" en los Inicio. `src/lib/patient-link.ts` (`readPatientResponse`, `patientLinkError`) en `/reserva` y `/gestionar`; cancelar solo citas agendadas/confirmadas futuras. `<Sonner style={{ pointerEvents: "auto" }} />`. `useCaseDeepLink` avisa "No encontramos ese caso" y quita `?caso=`. Detalle de cita admin sin acciones en citas completadas/canceladas (con explicación); Casos deshabilita estados de trabajo sin dueño. `userErrorMessage` (en `edge-function-error.ts`) traduce red/duplicados/dependencias y oculta mensajes técnicos; `extractEdgeFunctionError` mapea `FunctionsFetchError` a `network_error`. Diálogos de nueva cita esperan la lista real antes de limpiar el consultorio. `formatMx` / `mexicoDayLabel` en todas esas vistas; "Vence" se captura en CDMX. `ErrorBoundary` en `App.tsx`. Pruebas: `ProtectedRoute.test.tsx`, `useCaseDeepLink.test.tsx`, `AppointmentDetailDialog.test.tsx`, `CasosSheet.test.tsx`, `AppShell.test.tsx`, `DoctorCreateAppointmentDialog.test.tsx`, `Gestionar.test.tsx`, `edge-function-error.test.ts`, `query-client.test.ts`, `timezone.test.ts`.

**Lección aprendida:** Probar en navegador real con el ancho de un celular (con emulación móvil el contenido ancho agranda el viewport en vez de desbordar: medir contra el ancho del dispositivo, no contra `innerWidth`), con fallas y lentitud simuladas y con el navegador en otra zona horaria. Un guard de rutas no puede tratar "rol todavía desconocido" como permitido. Toda lectura necesita su estado de error; "vacío" y "falló" son mensajes distintos. Todo grid responsivo lleva `grid-cols-1` de base. Nunca `err.message` crudo en un toast: pasar por `userErrorMessage`. Un efecto que limpia una selección debe esperar a que la lista exista (no a la lista vacía de "cargando").

## 2026-10-20 — Reservar para un familiar renombraba al titular y WHAAPY no recibía los datos del paciente

**Categoría:** backend / datos / integración

**Síntoma:** Caso real del 19-oct reportado por el cliente: (1) "WHAAPY no jaló los datos del paciente de manera automática, los tuvimos que cargar manualmente": tras la migración a WHAAPY + MCP, el contacto del CRM se quedaba con el nombre de perfil de WhatsApp y sin aseguradora ni póliza, aunque el agente sí los había capturado. (2) Al agendar para un familiar con el mismo teléfono, el nombre del titular se sobrescribía: todas sus citas (pasadas y futuras), los mensajes y el Inbox pasaban a mostrar el nombre del familiar. (3) El equipo no tenía cómo corregir desde el panel el nombre, el teléfono ni "el beneficiario" de una cita.

**Causa raíz:** (1) En n8n cada dato se escribía en un campo del contacto con una herramienta por campo (N008–N012, N018); el MCP guarda el seguro y el nombre en la base de FindMed y nadie los proyectaba de vuelta a WHAAPY. (2) `patients` es una fila por teléfono (el titular), pero `createReservationSession` (`create_booking_link`/`triage-webhook`), `admin-create-appointment` y `doctor-create-appointment` hacían `UPDATE patients SET full_name = <nombre recibido>`; no existía dónde guardar "quién se atiende en esta cita". (3) `admin-update-patient-insurance` solo editaba el seguro.

**Solución aplicada:** Migración `20261020130000`: `appointments.patient_name` (quien se atiende; backfill con el nombre actual) y `reservation_sessions.patient_name`. `_shared/patient-identity.ts` (`matchOrCreatePatient`: nunca renombra al titular salvo un nombre de relleno; `attendedName`). Las 3 funciones guardan el nombre recibido en la cita; `reserve-create` lo toma de la sesión; `manage-reschedule` lo hereda. Todas las vistas, notificaciones, eventos de calendario y la variable `patient_name` de las plantillas usan `patient_name ?? patients.full_name`. `_shared/whaapy-contact-sync.ts` escribe en el contacto de WHAAPY `findmed_nombre_completo`, `findmed_aseguradora` y `findmed_numero_poliza` (llaves reales de `GET /contacts/v1/fields`) y el `name` solo si nadie del equipo lo eligió (vacío, teléfono, igual al perfil de WhatsApp o al que FindMed escribió antes); se llama tras `save_patient_insurance`, `create_booking_link`, `open_case`, `reserve-create` y `admin-update-patient-insurance`, en segundo plano (`EdgeRuntime.waitUntil`) y sin lanzar nunca. `admin-update-patient-insurance` acepta `action: "contact"` (titular, teléfono con `normalizeMxPhone` y 409 `phone_taken`, nombre de quien se atiende en una cita) y el panel tiene "Editar datos" en el detalle de cita y en el de caso.

**Lección aprendida:** Una fila por teléfono no es una fila por persona: cuando un número agenda para varias personas, el dato "quién se atiende" vive en la cita, y ningún flujo de reserva debe renombrar al dueño del número. Al reemplazar un orquestador (n8n) hay que inventariar también lo que escribía en sistemas externos (campos del CRM), no solo los mensajes: si nadie lo proyecta, el equipo termina capturándolo a mano. Y al escribir en un CRM que el equipo también edita, decidir explícitamente qué campos son de FindMed y nunca pisar lo que una persona escribió.
