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
