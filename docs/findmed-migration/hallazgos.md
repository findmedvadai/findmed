# Hallazgos — conciliación F01–F22 y hallazgos nuevos N01–N24

Revisión sobre `main` = `9ed5aa5` (12-oct-2026). El commit auditado por el plan (`cef120f`) ya no existe: el historial se
reescribió para purgar secretos; su contenido equivale al commit `feat: registro durable de auto/manual-disconnect…` del
historial nuevo. **Exposición previa declarada:** esta sesión auditó el repo antes de leer el plan v2 (3 agentes + verificación
directa), por lo que la revisión no es ciega; se buscó evidencia contraria a cada F.

Leyenda de **clasificación** (contraste con el plan): confirmado · parcial · corregido · refutado · pendiente.
Leyenda de **estado de ejecución**: pendiente · en revisión · en implementación · implementado sin validar · validado ·
bloqueado · no aplica (con justificación).

Tipo de evidencia: **[EXPORT]** comportamiento del JSON de referencia · **[CÓDIGO]** presente en el commit indicado ·
**[PROD]** observado en producción · **[DOC]** documentación oficial · **[HIP]** hipótesis pendiente de comprobar.

## F01–F22 (plan v2)

| ID | Clasificación | Evidencia en esta revisión | Componentes | Bloque | Estado | Criterio de cierre |
|---|---|---|---|---|---|---|
| F01 Varias coincidencias → respuesta negativa | confirmado [EXPORT] | `Switch1` main[1] (total>1) → `POST - Match Parcial` (texto "no tenemos médico"). | n8n N034, N090 → MCP `search_care_options` | B1, B5 | pendiente | R03 aprobado con el agente nativo. |
| F02 Llamadas al proyecto anterior | refutado para el sistema vivo según Alex (D1) [EXPORT] | El export llama `iepdgygvztocornqkkhk` en 4 nodos. Alex confirma que todo opera en `jyzvdowflblxmlahlupo`. Sin acceso al proyecto viejo para verificar. | N021, N033, N068, N069 | B0 | no aplica (D1) | Confirmar que ningún workflow activo apunta al proyecto viejo antes del corte (B10). |
| F03 Falta office_id al crear sesión | confirmado [EXPORT+CÓDIGO] | `triage-webhook/index.ts:89` exige `office_id`; el export envía solo doctor_id/nombre/teléfono/síntomas. | triage-webhook, MCP `create_booking_link` | B1, B5 | pendiente | R04: office_id elegido llega a `reservation_sessions`. |
| F04 Ciudad y cobertura desalineadas | confirmado [CÓDIGO] | `search-doctors/index.ts:126` `ilike('name', %ciudad%)` sin alias: "CDMX" no coincide con "Ciudad de México". El prompt limita a CDMX+Querétaro; el catálogo tiene 9 ciudades. | search-doctors, catálogo `cities` | B1 | pendiente | R02, R06, R07. Cobertura real por confirmar con FindMed. |
| F05 Handoff sin cierre verificable | confirmado [EXPORT] | Ramas de apoyo terminan en `Add Tag apoyo_asesor*`; no hay asignación ni pausa en el export. Automatizaciones WHAAPY externas no verificadas. | N065, N067, N108 → `open_case`/`request_handoff` | B6 | pendiente | R31, R32. |
| F06 Mensaje final omitido (condición invertida) | confirmado [EXPORT] | `If hay mensaje` true → `Set Campos bot` (no envía); false → `POST - Message2`. | N106, N107 | B8 | pendiente (se retira con n8n) | R12 con el agente nativo. |
| F07 `findmed_urgencia` vs `findmed_urgencias` | confirmado [EXPORT]; catálogo WHAAPY no releído en esta sesión | Tool envía `custom_fields.findmed_urgencia` (singular). | N016, campos WHAAPY | B8 | pendiente | R11: escribir y releer con contacto sintético. |
| F08 "Reservada" antes de cita persistida | confirmado [EXPORT] | `POST - Match Doctor` → `Wait1` → `POST - Volver al Inicio1` → `Add Tag reservada`. | N078, N086, N087, N117 | B7, B8 | pendiente | R13. |
| F09 SQL generado por el modelo | confirmado [EXPORT] | `SQL Query` usa `$fromAI('sql_query')`. Privilegios del rol Postgres no inspeccionados. | N002 | B5 (`suggest_specialty`) | pendiente | Ninguna tool expone SQL libre (R29). |
| F10 Base de triage no reconciliada | pendiente | `triage_findmed` y la memoria de chat usan la credencial "Vadai Postgress" del n8n, no Supabase FindMed. No hay acceso. | Postgres Vadai | B5 | bloqueado (acceso) | Localizar host/esquema, revisar contenido y migrar a tabla + RPC parametrizada. |
| F11 Alta de doctor incompleta | parcial [CÓDIGO] | `849d41c` (rama main) crea "Consultorio principal" + disponibilidad L–V 9–17 con office_id. Sigue sin transacción: fallo de `user_roles`/especialidades solo se loguea. No desplegado. | create-doctor | B3 | implementado sin validar (parte) | R14, R15. |
| F12 Creación de cita sin invariantes atómicas | parcial [CÓDIGO] | `reserve-create` reclama la sesión con UPDATE condicional y valida slot (commit `6e0dcff`→ reescrito). Exclusión GiST escrita en migración `20261012120000`, **no aplicada**. Falta idempotencia por operación. | reserve-create, migración | B4 | implementado sin validar | R18, R19, R21. |
| F13 Calendario externo puede fallar con éxito aparente | parcial [CÓDIGO] | `reserve-slots` reescrito a instantes absolutos y arreglado Outlook (N06). `_shared/slot-validation.ts:150` `maxResults=50`, sin paginación; `:171/:216` error externo = disponible; eventos de día completo ignorados. | slot-validation, reserve-slots | B4 | en revisión | R22, R23. |
| F14 Confirmación/cancelación ambigua | confirmado [CÓDIGO] | `update-appointment-status/index.ts:92-108`: primera cita `scheduled/confirmed` por teléfono (y primer paciente por `created_at`); cancelación no borra evento de calendario. | update-appointment-status | B4, B7 | pendiente | R26, R27, R28. |
| F15 Hora fija y solapamiento entre consultorios | parcial [CÓDIGO]; regla resuelta (D2) | `_shared/mx-time.ts` centraliza CDMX (−06:00); sin zona IANA por sede. D2 implementado: exclusión `appointments_no_overlap_per_doctor`, `slot-validation` y `reserve-slots` con alcance de doctor, 23P01→409 en las 6 funciones que escriben citas. Migración no aplicada. | mx-time, slot-validation, reserve-slots, migración | B2-bis, B4 | implementado sin validar (regla); pendiente (IANA) | R24, R25. |
| F16 Superficies privilegiadas sin auth | corregido [CÓDIGO+PROD parcial] | `seed-admin` borrada del repo y de producción (404 verificado). `dispatch-webhook` con `isServiceRequest` o JWT+allowlist — **no desplegado**. | dispatch-webhook, seed-admin | B2 | implementado sin validar | Deploy + probe anónimo = 401 (R30). |
| F17 Contraseñas iniciales persistidas | confirmado [CÓDIGO]; riesgo aceptado (D3) | `create-doctor`, `update-doctor-credentials` escriben `users.initial_password`; UI las muestra. | users, Doctores.tsx | — | no aplica por ahora (D3) | Revisar al reabrir la decisión. |
| F18 Dos entradas de seguimiento sin procesamiento | confirmado [EXPORT] | `Webhook Info Formulario Doc` main vacío; `Webhook Envío Informe` sin sucesores. | N050, N052 | B7 | pendiente (decisión EV06/EV07) | R37. |
| F19 Entrega de eventos sin autenticación ni durabilidad | confirmado [CÓDIGO+EXPORT] | `dispatch-webhook` firma HMAC pero el export no la verifica; no hay outbox; resultados solo en la respuesta. | dispatch-webhook, n8n | B7 | pendiente | R33, R34, R36. |
| F20 Inbox ≠ CRM | confirmado [CÓDIGO] | `Inbox.tsx` lista notificaciones; no hay entidad de caso. | Inbox, nuevo `patient_cases` | B6 | pendiente | R31, R32, R10. |
| F21 Datos incompletos y regresión poco cubierta | confirmado [CÓDIGO]; datos no re-consultados (403) | Suite: 6 tests triviales. Conteos de consultorios del plan no re-verificados en esta sesión. | tests, reporte de datos | B3, B9 | pendiente | Reporte de consultorios incompletos + suite R. |
| F22 Documentación y deployment divergen | confirmado | CLAUDE.md actualizado en esta sesión, pero las funciones en prod siguen en versión del 1-jul. | CLAUDE.md, manifiesto | B10 | en implementación | Manifiesto por entrega (`estado-actual.md` §Deploy). |

## Hallazgos nuevos N01–N24

| ID | Severidad | Hallazgo | Evidencia | Estado | Cierre |
|---|---|---|---|---|---|
| N01 | P0 | `service_role` key de producción estaba commiteada en el repo público desde 2026-04-27. | Hash de la key del historial = hash de la key activa del proyecto = valor en Vault `service_role_key` [PROD]. Historial purgado y force-push hecho por Alex. | implementado sin validar | **Rotación**: Vault → `sb_secret_`, desactivar llaves legacy, revocar JWT secret legacy. |
| N02 | P0 | ~52 contraseñas reales en `fix_passwords.cjs` y `scripts/recreate-auth-users.cjs`. | Archivos eliminados y purgados del historial. | pendiente | Reset de contraseñas por Alex/FindMed. |
| N03 | P0 | `generate-manage-link` y `confirm-appointment` públicos: con un teléfono se obtenía el link `/gestionar` o se confirmaba cita ajena. | Código corregido (API key / service key / solo manage_token). El export n8n **no** los llama (D4). | implementado sin validar | Deploy + probe anónimo = 401. |
| N04 | P1 | 12 funciones de calendario aceptaban JWT forjado (`atob` sin firma), 9 con `verify_jwt=false`. | Reemplazado por `verifyJwtClaims` (getClaims). | implementado sin validar | Deploy + token forjado = 401. |
| N05 | P1 | Tokens de paciente, API keys y secrets de webhook con `Math.random`. | `generateSecureToken` / `secureRandomString`. | implementado sin validar | Deploy. |
| N06 | P1 | `reserve-slots` usaba `tokenData.access_token` (inexistente) → Outlook nunca bloqueaba slots. | Corregido; Deno check ya no reporta TS2304. | implementado sin validar | R22/R23 con Outlook de prueba. |
| N07 | P1 | `manage-reschedule`: `manage_url` con `token=undefined`, statuses hardcodeados, cancelaba la cita antes de insertar la nueva, token con expiry viejo, sin chequeo de choques. | Corregido. | implementado sin validar | R27. |
| N08 | P1 | Crons sin marcador de envío (recordatorio 48 h doble) y updates sin guarda de estado. | Marcadores + claim atómico + guardas. Migración no aplicada. | implementado sin validar | R35. |
| N09 | P2 | Schedules de pg_cron solo existían en la BD de producción. | Versionados en migración `20261012120000` vía `invoke_edge_function`. | implementado sin validar | `db push` + `cron.job` coincide. |
| N10 | P1 | `/gestionar` pedía slots con doctor_id (consultorio equivocado en multi-sede). | Corregido en `Gestionar.tsx`. | implementado sin validar | Deploy Vercel + R04 en reagenda. |
| N11 | P2 | `PasswordGate` con contraseña literal en el bundle. | `src/components/admin/PasswordGate.tsx:15`. | pendiente | Sustituir por rol `superadmin` o validación server-side. |
| N12 | P1 | OAuth `state` sin firma ni nonce + redirección a origen arbitrario. | `google/outlook-calendar-auth/callback`. | pendiente | `state` HMAC + allowlist de orígenes. |
| N13 | P1 | RLS laxa: doctor puede UPDATE cualquier columna de su cita y leer refresh tokens; admin puede otorgarse `superadmin`; `notifications` sin WITH CHECK. | Migraciones M1, `20260428170000`. | pendiente | Migración de políticas + pruebas RLS. |
| N14 | P2 | `webhooks.secret` en texto plano y legible desde el navegador. | `Webhooks.tsx` `select("*")`. | pendiente | Secret write-only / mostrar una sola vez. |
| N15 | P2 | Tipos desincronizados: `tsc` 16 errores, Deno check 155 errores previos; `types.ts` editado a mano. | Línea base registrada. | pendiente | `supabase gen types` + reducción progresiva. |
| N16 | P3 | `dispatch-webhook` ignora `webhooks.payload_overrides` (editable en la UI). | Código. | pendiente | Se resuelve al migrar a worker (B7) o se retira el campo. |
| N17 | P2 | "Por completar" permite formularios post-consulta duplicados y saltarse el formulario. | `PorCompletar.tsx:40,143,168`. | pendiente | Filtrar por existencia de formulario + `UNIQUE(appointment_id)`. |
| N18 | P2 | `ProtectedRoute` deja pasar usuarios con rol `null`. | `useAuth.tsx:55-60`, `ProtectedRoute.tsx:25`. | pendiente | Requiere confirmación (regla CLAUDE.md: no cambiar useAuth/ProtectedRoute sin aprobación). |
| N19 | P2 | Fechas en hora del navegador en páginas de paciente y listas. | `Reserva.tsx`, `Gestionar.tsx`, `Reservas.tsx`, inboxes. | pendiente | Usar `formatMx`. |
| N20 | Diseño | WHAAPY firma webhooks con `HMAC-SHA256(JSON.stringify(payload))` y headers `X-Webhook-Signature/-Event/-Timestamp/-ID`. El plan (§6, R36) asume "raw body". | [DOC] `/api-reference/webhooks/security`. | en revisión | `whaapy-inbound` verifica según la doc + prueba con webhook real. |
| N21 | Diseño | Variables documentadas para mapear campos de tools MCP: `contact.name/first_name/phoneNumber/email`, `business.*`, `system.*`. No se documentan `contact.id` ni `conversation.id`. | [DOC] `/guides/automations/variables`, `/guides/agent-mcps`. | en revisión | Confirmar en el selector real; si no existen, identidad = teléfono inyectado. |
| N22 | P3 | El nodo "Gemini 2.5 flash" del recorrido principal usa `openai/gpt-5.6-luna`. | [EXPORT] N006. | no aplica (se retira) | — |
| N23 | Diseño | La API de envío de WHAAPY no documenta idempotency key. | [DOC] `/api-reference/messages/send-templates`. | en revisión | Outbox registra estado incierto y reconcilia con `message.delivered/failed`. |
| N24 | Diseño | Botones quick-reply de templates aceptan payload propio con `allowButtonIdOverride`. | [DOC] `/api-reference/messages/send-templates`. | en revisión | Botón con `{acción, appointment_id, nonce}` probado en número de prueba. |
