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
