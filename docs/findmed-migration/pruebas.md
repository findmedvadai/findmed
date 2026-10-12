# Pruebas

Estados: **passed** · **failed** · **blocked** · **not_run**. Un mock aprobado no acredita la integración real.
Tipos: U = unitaria · IS = integración simulada (fixtures/mocks) · IR = integración real (Supabase local/prueba, número WHAAPY de prueba) · OP = validación operativa con FindMed.
Datos siempre sintéticos. Nunca pacientes ni citas reales.

## Línea base (12-oct-2026, antes de esta migración)

| Verificación | Resultado | Nota |
|---|---|---|
| `npm run build` | ok | bundle principal 1.1 MB (sin code-splitting) |
| `npm run lint` | 83 errores, 9 warnings | previos; no se ocultan con desactivaciones globales |
| `npx tsc -p tsconfig.app.json --noEmit` | 16 errores | previos (types.ts desincronizado, N15) |
| `deno check` de las Edge Functions | 155 errores previos | 142 tras B2-bis (reserve-slots en 0 al usar un select literal); ningún error nuevo por archivo |
| `npm run test` | 6 passed | legales + ejemplo; no cubren agenda, MCP ni WhatsApp |

## Pruebas ya ejecutadas en esta sesión

| ID | Qué | Tipo | Resultado | Evidencia |
|---|---|---|---|---|
| P-001 | `generateSecureToken`: longitud, alfabeto, 2,000 tokens sin colisión | U | passed | script Deno en scratchpad |
| P-002 | `isServiceRequest`: legacy, `sb_secret_` en apikey y Bearer, publishable/usuario rechazados | U | passed | script Deno |
| P-003 | `mx-time`: ida y vuelta, cruce de medianoche, límites del día, `mxToday` a las 05:59/06:00 Z, validadores | U | passed | script Deno |
| P-004 | `supabase-keys`: prefiere `SUPABASE_SECRET_KEYS`, cae a legacy, toma primera publishable | U | passed | script Deno |
| P-005 | `seed-admin` eliminada en producción responde 404 | IR | passed | `curl` 12-oct |
| P-006 | `dispatch-webhook` (versión vieja en prod) acepta llamadas anónimas | IR | passed (confirma el defecto) | evento falso sin suscriptores → 200 |
| P-007 | Vault `service_role_key` = key legacy filtrada | IR | passed (confirma N01) | comparación de hashes, sin imprimir valores |

> P-001–P-004 versionados en `supabase/tests/shared-helpers_test.ts`. Correr todo con `npm run test:edge` (6 tests, 8 pasos, passed el 12-oct).

## Suite R01–R40

| R | Qué verifica | Tipo | Bloque | Depende de | Estado |
|---|---|---|---|---|---|
| R01 | "Quiero una cita" sin especialidad: preguntas breves, sin negar médicos | OP | B8 | B5 | not_run |
| R02 | "Ortopedista en CDMX" ≡ "Ortopedia / Ciudad de México" | U+IR | B1 | — | U passed (`care-search_test.ts`); IR not_run |
| R03 | Tres opciones: presentar alternativas con consultorio, nunca "no tenemos" | IS+OP | B1, B8 | B5 | not_run |
| R04 | Una opción: confirmar sede y propagar doctor_id/office_id hasta la reserva | IR | B1, B5 | — | not_run |
| R05 | Cero opciones: explicar límite y abrir caso/handoff | OP | B6, B8 | B5 | not_run |
| R06 | Zona/ciudad ambigua: aclarar, no inventar | U+OP | B1, B8 | — | U passed (`ambiguous_city`/`unknown_zone`); OP not_run |
| R07 | Solicitud en cualquier ciudad del catálogo (D6), no la regla vieja CDMX/QRO | OP | B8 | — | not_run |
| R08 | Señal de urgencia según protocolo aprobado | OP | B8 | texto clínico aprobado | blocked |
| R09 | Estudio/laboratorio sin agenda: caso rastreable, sin cita inventada | IR | B6 | — | not_run |
| R10 | Seguimiento: solo datos del propio paciente | IR | B6 | — | not_run |
| R11 | Campo de urgencia: escribir y releer nombre canónico | IR | B8 | número de prueba | blocked |
| R12 | Mensaje final una sola vez, sin metadata | OP | B8 | — | not_run |
| R13 | Enlace emitido sin reservar ≠ cita agendada | IR | B7, B8 | — | not_run |
| R14 | Alta médica completa (Auth, rol, especialidades, sede) | IR | B3 | Supabase local | not_run |
| R15 | Fallo a mitad del alta y reintento | IR | B3 | Supabase local | not_run |
| R16 | Consultorio sin horarios/inactivo/eliminado no ofrece slots | U+IR | B4 | — | U passed (`day-slots_test.ts`); IR not_run |
| R17 | office_id de otro doctor rechazado | U+IR | B4 | — | U passed (`create_booking_link`); IR not_run |
| R18 | Dos reservas al mismo horario → máximo una | IS (PGlite) / IR | B2-bis, B4 | IR: Postgres con 2 conexiones | IS passed (`supabase/tests/booking-constraint_test.ts`); IR not_run |
| R19 | Reintento tras timeout devuelve resultado original; payload distinto → conflicto | IR | B4 | — | not_run |
| R20 | Horario pasado, fuera de bloque o malformado → rechazo | U+IR | B4 | — | U passed (fecha malformada/pasada en day-slots); IR not_run |
| R21 | Sesión vencida o consumida no crea otra cita | IR | B4 | — | not_run |
| R22 | Token Google revocado vs fallo temporal: estados distintos, sin "verificado" falso | IS+IR | B4 | calendario de prueba | IS passed (calendario caído → `external_calendar_unverified`); IR blocked |
| R23 | >50 eventos y bloqueo de día completo | IS+IR | B4 | calendario de prueba | not_run |
| R24 | Sede en otra zona horaria y cruce de medianoche | U | B4 | IANA por sede (pendiente) | not_run |
| R25 | Mismo doctor en dos consultorios (regla D2) | IS (PGlite) / IR | B2-bis | prod: migración aplicada | IS passed; IR not_run |
| R26 | Paciente con varias citas: elección explícita de appointment_id | U+IR | B4, B5 | — | U passed (`appointment-actions_test.ts`); IR not_run |
| R27 | Cancelar/reagendar desde paciente, doctor, staff y botón: misma transición | IR | B4, B7 | — | not_run |
| R28 | Cita ajena, identidad sustituida o botón reenviado → denegado | IR | B4, B5 | — | not_run |
| R29 | Protocolo MCP (initialize/list/call, 202, errores JSON-RPC, additionalProperties) | U+IR | B5 | cliente WHAAPY para la parte IR | U passed (`findmed-mcp_test.ts`); IR blocked |
| R30 | MCP sin token / scope insuficiente / timeout | U+IR | B5 | — | U passed (401 sin token, token erróneo y secret ausente); timeout por revisar en IR |
| R31 | Handoff con agente disponible: caso, asignación, pausa, sin doble respuesta | IR+OP | B6 | número de prueba | blocked |
| R32 | Handoff sin personal o error del proveedor → `awaiting_assignment` | IS+IR | B6 | — | not_run |
| R33 | Eventos repetidos/desordenados no duplican ni retroceden embudo (EV01–EV08) | U+IR | B7 | — | not_run |
| R34 | 429/5xx, respuesta perdida, reinicio del worker | IS | B7 | — | not_run |
| R35 | Recordatorio vs confirmación vs autocancelación en carrera | U+IR | B7 | migración | U passed (guarda de estado previo en confirm/cancel); IR not_run |
| R36 | Firma inválida o evento repetido rechazado (WHAAPY firma JSON re-serializado, N20) | U+IR | B7 | webhook de prueba | not_run |
| R37 | Postconsulta y envío de informe con recorrido definido | OP | B7 | decisión EV06/EV07 | blocked |
| R38 | Corte de agente y eventos en momentos distintos: un solo dueño | OP | B10 | — | not_run |
| R39 | Reversión con operaciones en vuelo | OP | B10 | — | not_run |
| R40 | Recorrido completo (nuevo, recurrente, sin reserva automática) | OP | B9 | B3–B8 | not_run |

T01–T30: **no disponibles** (Especificación Findi v2.0 no suministrada). No se sustituyen.
