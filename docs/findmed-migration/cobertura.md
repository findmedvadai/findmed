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
| B4 | Dominio de citas: acciones comunes, idempotencia, calendario honesto | B1, B2 | R17–R28 | en implementación |
| B5 | `findmed-mcp` | Lectura: B1+B2; escritura: B4 | R29, R30 | pendiente |
| B6 | Casos y handoff | B2, B5; token API WHAAPY | R31, R32, R10 | pendiente |
| B7 | Outbox, worker, `whaapy-inbound`, templates | B2, B4; token y webhook WHAAPY de prueba | R33–R37 | pendiente |
| B8 | Agente WHAAPY (prompt, tools, campos, embudo) | B5, B6; reglas clínicas aprobadas | R01–R13 | pendiente |
| B9 | Validación conjunta | B3–B8; número de prueba | R40 + T01–T30 si existen | pendiente |
| B10 | Deploy, corte, reversión | B9; acceso Owner; indicación de Alex | R38, R39; manifiesto | pendiente |

## Herramientas M01–M11 → implementación

| M | Capacidad | Tool (A3) | Seguridad | Bloque | Estado |
|---|---|---|---|---|---|
| M01 | Opciones de atención (none/one/many, office_id) | `search_care_options` | lectura | B1, B5 | en implementación (dominio listo en `_shared/care-search.ts`; falta tool MCP) |
| M02 | Sugerir especialidad | `suggest_specialty` | lectura | B5 | bloqueado (F10) |
| M03 | Horarios disponibles con estado de verificación | `list_available_slots` | lectura | B4, B5 | pendiente |
| M04 | Enlace de reserva | `create_booking_link` | escritura limitada | B5 | pendiente |
| M05 | Mis citas | `list_my_appointments` | lectura privada | B5 | pendiente |
| M06 | Preparar acción | `prepare_appointment_action` | preparación | B4, B5 | pendiente |
| M07 | Ejecutar acción confirmada | `commit_appointment_action` | escritura | B4, B5 | pendiente (flag apagado hasta A4) |
| M08 | Estado de operación | `get_operation_status` | lectura privada | B4, B5 | pendiente |
| M09 | Abrir caso | `open_case` | escritura | B6 | pendiente |
| M10 | Solicitar humano | `request_handoff` | escritura | B6 | pendiente |
| M11 | Estado de mi caso | `get_my_case_status` | lectura privada | B6 | pendiente |

## Eventos EV01–EV08

| EV | Evento FindMed | Webhook n8n | Templates | Destino | Decisión pendiente | Estado |
|---|---|---|---|---|---|---|
| EV01 | `appointment.status_changed` | findmed-CambioEstado | reservada_estado_cita, confirmada_estado_cita, cancelada_paciente, cita_completada | outbox + worker; embudo desde transición persistida | Evitar doble aviso con eventos específicos de cancelación | pendiente |
| EV02 | `appointment.cancelled_by_doctor` | findmed-cancelacionDoctor | canceladadoc_estado_cita | outbox + worker; caso de reubicación si FindMed lo aprueba | ¿Abrir caso automático? | pendiente |
| EV03 | `appointment.reminder_48h` | findmed-Confirmacion | dosdias_pre_confirmacion (+ botones) | cron idempotente (N08) → outbox → worker; botones con appointment_id | — | pendiente |
| EV04 | `appointment.auto_cancelled` | findmed-Autocancelacion | autocancelada_estado_cita | outbox + worker; calendario reconciliado | — | pendiente |
| EV05 | `appointment.reminder_day_of` | findmed-Recordatorio8am | cita_manana_recordatorio (+ botón cancelar) | outbox + worker | **Contradicción "día de 8 am" vs template "mañana"**: revisar cuerpo real | pendiente |
| EV06 | `postconsultation.submitted` | findmed-Formulario_doc (sin consumidor) | — | caso/notificación interna | ¿Se avisa al paciente? | pendiente |
| EV07 | `postconsultation.report_sent` | findmed-Envio_informe (sin consumidor) | — | por definir | **Semántica: solicitud vs envío realizado** | pendiente |
| EV08 | `appointment.rescheduled_by_staff` | findmed-reagendado | cita_reagendada_staff | outbox + worker; revisar también reagenda de paciente/doctor | — | pendiente |

## Requisitos adicionales (instrucciones de Alex, 12-oct)

| ID | Garantía | Dónde se cubre | Estado |
|---|---|---|---|
| X01 | Selección explícita de médico y consultorio | M01, M04, F01, F03 | pendiente |
| X02 | Propagación y validación doctor_id/office_id | B1, B4, triage-webhook | pendiente |
| X03 | Cero / una / varias coincidencias distintas | M01, R03–R05 | implementado sin validar (campo `result` + `reason`) |
| X04 | Disponibilidad real, zona horaria, salud de calendario | B4, F13, F15, N06 | en implementación |
| X05 | Sin reservas simultáneas incompatibles | A8, D2, R18 | implementado sin validar |
| X06 | Idempotencia y recuperación tras timeout | B4 (`operation_requests`), M08, R19 | pendiente |
| X07 | Propiedad de cada cita y caso | A2, R28 | pendiente |
| X08 | Confirmación auténtica antes de acciones | A4, A6 | pendiente |
| X09 | Cancelar/reagendar coherente en BD, calendario y mensajes | B4 `appointment-actions`, R27 | pendiente |
| X10 | Canalización humana verificable | A7, R31, R32 | pendiente |
| X11 | Un dueño por conversación y evento durante la migración | A5 `event_owner`, R38 | pendiente |
| X12 | Enlace ≠ cita; etiqueta ≠ asignación; HTTP 200 ≠ entrega | Contratos MCP, outbox, R13, R31, R34 | pendiente |
