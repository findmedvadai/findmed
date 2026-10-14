# Registro de cobertura

Fuentes: `FINDMED-Plan-Claude-Code.txt` v2 (12-oct-2026, 1,407 líneas, secciones 0–14, leído completo),
`FINDMED-N8N-Referencia-Sin-Secretos.json` (117 nodos, 8 webhooks, 12 templates), repo en `9ed5aa5`,
documentación oficial de WHAAPY (MCP spec, agent-mcps, agent-control, ai-handoff, ai-control, webhooks, templates).
Ninguno de los dos archivos fuente se versiona.

Hallazgos F01–F22 y N01–N24: ver [hallazgos.md](hallazgos.md). Nodos: [n8n-nodos.md](n8n-nodos.md). Pruebas: [pruebas.md](pruebas.md).
Estados: pendiente · en revisión · en implementación · implementado sin validar · validado · bloqueado · no aplica (justificado).

## Conteos conciliados

| Elemento | Plan | Encontrado | Nota |
|---|---|---|---|
| Secciones | 15 (0–14) | 15 | El plan dice "14 secciones" en el índice pero numera 0–14. |
| Hallazgos F | 22 | 22 | + 24 nuevos (N01–N24). |
| Bloques | 11 (0–10) | 11 | |
| Herramientas M | 11 | 11 → 11 capacidades en 11 tools (A3) | M02 condicionada a F10. |
| Eventos EV | 8 | 8 webhooks n8n | Coinciden con las 8 suscripciones. |
| Pruebas R | 40 | 40 | + pruebas nuevas en `pruebas.md`. |
| Nodos n8n | 117 | 117 (100 principal, 4 desconectados, 13 notas) | |
| Templates | 12 | 12 | `pedir_documentos` sin definición de recorrido. |
| T01–T30 | referidos | 0 disponibles | Especificación Findi v2.0 no suministrada: **no se inventan**. |

## Secciones del plan

| § | Contenido | Tratamiento | Estado |
|---|---|---|---|
| 0 | Mandato de análisis independiente | Diagnóstico propio + conciliación en `hallazgos.md`; exposición previa declarada. | validado (B0) |
| 1 | Uso del archivo / primer mensaje | Plan Mode ejecutado; documentos persistidos aquí. | validado |
| 2 | Evidencia y contexto | E01–E06 reconciliados en `estado-actual.md` (E01 commit ya no existe). | validado |
| 3 | Estado actual | `estado-actual.md`; conteos de datos no re-verificados (acceso 403). | bloqueado (parte datos) |
| 4 | F01–F22 | `hallazgos.md`. | en revisión |
| 5 | Arquitectura | `decisiones.md` A1–A9. | validado (diseño) |
| 6 | Datos, reglas y contratos MCP | A2–A8; tablas nuevas se crearán por bloque. | en implementación |
| 7 | Eventos, plantillas, campos | EV01–EV08 abajo; plantillas y campos en B7/B8. | pendiente |
| 8 | Secuencia y aceptación | Bloques abajo. | en implementación |
| 9 | Prompts 0–10 | Adaptados a A1–A9; no se ejecutan literalmente. | en implementación |
| 10 | R01–R40 | `pruebas.md`. | pendiente |
| 11 | Deployment | Runbook en B10. | pendiente |
| 12 | Alcance y pendientes | `estado-ejecucion.md` §Bloqueos. | en revisión |
| 13 | Referencias | Docs WHAAPY releídas el 12-oct vía MCP de documentación. | validado |
| 14 | Inventario de nodos | `n8n-nodos.md` generado por script. | validado |

## Bloques de ejecución

| Bloque | Objetivo | Dependencia real | Aceptación | Estado |
|---|---|---|---|---|
| B0 | Diagnóstico, conciliación, cobertura persistente | — | Documentos sin secretos; conteos conciliados | validado |
| B1 | Búsqueda: alias, none/one/many, office_id extremo a extremo | B0 | R02–R06 | implementado sin validar (`_shared/care-search.ts`, search-doctors, validación de teléfono) |
| B2 | Entradas privilegiadas e identidad | B0; deploy requiere acceso | Probes anónimos = 401; productores legítimos OK | implementado sin validar (código en main) |
| B2-bis | Regla D2 (bloqueo por doctor) en BD y validadores | B0 | Solapamientos existentes revisados; R18, R25 | implementado sin validar (IS passed; falta aplicar en prod) |
| B3 | Alta médica transaccional y reporte de consultorios | B2 | R14–R16 | implementado sin validar (parcial) |
| B4 | Dominio de citas: acciones comunes, idempotencia, calendario honesto | B1, B2 | R17–R28 | implementado sin validar (partes 1 y 2) |
| B5 | `findmed-mcp` | Lectura: B1+B2; escritura: B4 | R29, R30 | implementado sin validar (fase lectura + enlace; U passed; IR bloqueado sin WHAAPY de prueba) |
| B6 | Casos y handoff | B2, B5; token API WHAAPY | R31, R32, R10 | implementado sin validar (código + U; migración y deploy pendientes de OK; IR con número de prueba) |
| B7 | Outbox, worker, `whaapy-inbound`, templates | B2, B4; token y webhook WHAAPY de prueba | R33–R37 | implementado sin validar (U 89 passed; migración/deploy pendientes de OK; todos los eventos siguen en n8n) |
| B7b | Centro de mensajería en el admin (D8): templates desde API WHAAPY, mapeo evento→template, historial de envíos/entregas | B7; `WHAAPY_API_KEY` | X13; R33, R34 | implementado sin validar (`/admin/mensajeria` + `messaging-admin`) |
| B8 | Agente WHAAPY (prompt, tools, campos, embudo) | B5, B6; reglas clínicas aprobadas | R01–R13 | pendiente |
| B9 | Validación conjunta | B3–B8; número de prueba | R40 + T01–T30 si existen | pendiente |
| B10 | Deploy, corte, reversión | B9; acceso Owner; indicación de Alex | R38, R39; manifiesto | pendiente |

## Herramientas M01–M11 → implementación

| M | Capacidad | Tool (A3) | Seguridad | Bloque | Estado |
|---|---|---|---|---|---|
| M01 | Opciones de atención (none/one/many, office_id) | `search_care_options` | lectura | B1, B5 | implementado sin validar |
| M02 | Sugerir especialidad | `suggest_specialty` | lectura | B5 | bloqueado (F10) |
| M03 | Horarios disponibles con estado de verificación | `list_available_slots` | lectura | B4, B5 | implementado sin validar (`_shared/day-slots.ts`) |
| M04 | Enlace de reserva | `create_booking_link` | escritura limitada | B5 | implementado sin validar (`_shared/booking-session.ts`) |
| M05 | Mis citas | `list_my_appointments` | lectura privada | B5 | implementado sin validar |
| M06 | Preparar acción | `prepare_appointment_action` | preparación | B4, B5 | implementado sin validar (`_shared/operations.ts`) |
| M07 | Ejecutar acción confirmada | `commit_appointment_action` | escritura | B4, B5 | implementado sin validar, publicado solo con `MCP_CHAT_ACTIONS_ENABLED=true` (A4) |
| M08 | Estado de operación | `get_operation_status` | lectura privada | B4, B5 | implementado sin validar |
| M09 | Abrir caso | `open_case` | escritura | B6 | implementado sin validar |
| M10 | Solicitar humano | `request_handoff` | escritura | B6 | implementado sin validar |
| M11 | Estado de mi caso | `get_my_case_status` | lectura privada | B6 | implementado sin validar |

## Eventos EV01–EV08

| EV | Evento FindMed | Webhook n8n | Templates | Destino | Decisión pendiente | Estado |
|---|---|---|---|---|---|---|
| EV01 | `appointment.status_changed` | findmed-CambioEstado | reservada_estado_cita, confirmada_estado_cita, cancelada_paciente, cita_completada | outbox + worker; embudo desde transición persistida | Evitar doble aviso con eventos específicos de cancelación | pendiente |
| EV02 | `appointment.cancelled_by_doctor` | findmed-cancelacionDoctor | canceladadoc_estado_cita | outbox + worker; caso de reubicación si FindMed lo aprueba | ¿Abrir caso automático? | pendiente |
| EV03 | `appointment.reminder_48h` | findmed-Confirmacion | dosdias_pre_confirmacion (+ botones) | cron idempotente (N08) → outbox → worker; botones con appointment_id | — | pendiente |
| EV04 | `appointment.auto_cancelled` | findmed-Autocancelacion | autocancelada_estado_cita | outbox + worker; calendario reconciliado | — | pendiente |
| EV05 | `appointment.reminder_day_of` | findmed-Recordatorio8am | cita_manana_recordatorio (+ botón cancelar) | outbox + worker | Resuelto (12-oct, cuerpo real vía API): el template dice "el día de hoy"; es recordatorio del mismo día, solo el nombre engaña | pendiente |
| EV06 | `postconsultation.submitted` | findmed-Formulario_doc (sin consumidor) | — | caso/notificación interna | Evidencia 12-oct: no existe template al paciente → evento interno (interpretación, confirmar con FindMed) | pendiente |
| EV07 | `postconsultation.report_sent` | findmed-Envio_informe (sin consumidor) | — | por definir | No existe template al paciente → interno; semántica solicitud vs envío sigue por confirmar | pendiente |
| EV08 | `appointment.rescheduled_by_staff` | findmed-reagendado | cita_reagendada_staff | outbox + worker; revisar también reagenda de paciente/doctor | — | pendiente |

## Plantillas WHAAPY (leídas por API el 12-oct)

37 aprobadas (es_MX). Las 12 del flujo n8n existen. Las de estado usan botón URL `https://app.findmed.com.mx/gestionar?token={{1}}` (camino seguro). `boton_confirmar_cita` / `boton_cancelar_cita` son plantillas MARKETING separadas con QUICK_REPLY (hoy procesadas por n8n por teléfono, F14 → A6). `pedir_documentos` pide póliza + INE por WhatsApp: los archivos llegan como `message.received` con `media_url` de 24 h → B7b debe guardarlos en almacenamiento privado. Hay 25 plantillas adicionales (varias duplicadas/antiguas) a depurar en el centro de mensajería.

## Requisitos adicionales (instrucciones de Alex, 12-oct)

| ID | Garantía | Dónde se cubre | Estado |
|---|---|---|---|
| X01 | Selección explícita de médico y consultorio | M01, M04, F01, F03 | pendiente |
| X02 | Propagación y validación doctor_id/office_id | B1, B4, triage-webhook | pendiente |
| X03 | Cero / una / varias coincidencias distintas | M01, R03–R05 | implementado sin validar (campo `result` + `reason`) |
| X04 | Disponibilidad real, zona horaria, salud de calendario | B4, F13, F15, N06 | en implementación |
| X05 | Sin reservas simultáneas incompatibles | A8, D2, R18 | implementado sin validar |
| X06 | Idempotencia y recuperación tras timeout | B4 (`operation_requests`), M08, R19 | implementado sin validar |
| X07 | Propiedad de cada cita y caso | A2, R28 | implementado sin validar (citas y casos; U en `operations_test.ts` y `cases_test.ts`) |
| X08 | Confirmación auténtica antes de acciones | A4, A6 | en implementación (prepare/commit + evidencia registrada; commit por chat apagado) |
| X09 | Cancelar/reagendar coherente en BD, calendario y mensajes | B4 `appointment-actions`, R27 | en implementación (confirm/cancel de paciente unificados; staff y reagenda pendientes) |
| X10 | Canalización humana verificable | A7, R31, R32 | implementado sin validar (U passed; IR bloqueada por número de prueba) |
| X11 | Un dueño por conversación y evento durante la migración | A5 `event_owner`, R38 | pendiente |
| X13 | FindMed gestiona plantillas, envíos y su estado desde su frontend, sin entrar a WHAAPY (D8) | B7b: catálogo vía API WHAAPY (crear plantillas sigue siendo en Meta: la API solo lista/sincroniza), mapeo evento→plantilla editable y validado, dueño por evento, historial con recibos, reenvío | implementado sin validar |
| X12 | Enlace ≠ cita; etiqueta ≠ asignación; HTTP 200 ≠ entrega | Contratos MCP, outbox, R13, R31, R34 | en implementación (`link_created`/`appointment_created:false` en MCP) |

## Cobertura de pruebas automatizadas por área (14-oct, auditoría de construcción)

`npm run test` (vitest): 18 archivos, 80 pruebas. `npm run test:edge` (Deno, 25 archivos en `supabase/tests/`): 270 pruebas. No hay medición de cobertura por líneas; la tabla es por flujo.

| Área | Cubierto por pruebas | Sin pruebas automatizadas (riesgo) |
|---|---|---|
| Agente / MCP | `findmed-mcp_test`, `triage_test`, `triage-admin_test`, `care-search_test`, `geo-proximity_test`, `insurance-network-documents_test` | — |
| Mensajería WHAAPY | `messaging_test`, `messaging-admin_test`, `whaapy-inbound_test`, `staff-alerts_test` | Llamadas reales a la API (solo IR manual) |
| Casos / post-consulta | `cases_test`, `postconsult-routes_test`, `operations_test`, `appointment-actions_test`; UI `cases-ui.test`, `PorCompletar.test` | `case-actions` (handler HTTP) |
| Disponibilidad | `day-slots_test`, `calendar-busy_test`, `booking-constraint_test` (PGlite: exclusión por doctor) | `reserve-slots` (handler), `checkAvailability` |
| Reserva del paciente | `Gestionar.test` (UI), constraint en BD | **`reserve-create`**, **`manage-reschedule`**, `manage-cancel`, `reserve-validate`/`manage-validate` (handlers sin pruebas; la lógica vive en `index.ts`) |
| Citas por staff | — | **`admin-/doctor-create-appointment`**, **`admin-/doctor-reschedule-appointment`**, `admin-cancel-appointment`, `cancel-by-doctor` (código casi duplicado, sin pruebas) |
| Calendarios externos | `calendar-tokens_test`, `oauth-state_test` | `google/outlook-calendar-*` (create/update/delete/events/list/callback) |
| Crons | `cron-url-migration_test` (migración) | Los 4 handlers (`send-*-reminders`, `auto-cancel-unconfirmed`, `auto-complete-appointments`) |
| Doctores / consultorios | `create-doctor_test` | `doctor-office-create/update/delete`, `update-doctor-credentials` |
| Frontend | `timezone`, `plural`, `case-sla`, `management-type`, `geo-coords`, `settings-unlock`, `admin-appointment-queries`, `triage-admin`, `PasswordGate`, `PatientInsurance`, `Alertas`, `Legal`, `lazy-with-reload`, humo de rutas (`app-routes.test`) | `Reserva.tsx`, Agenda (admin y doctor), Doctores, `useAuth`/`ProtectedRoute`/`Login` |
