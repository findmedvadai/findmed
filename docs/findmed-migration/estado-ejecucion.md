# Estado de ejecución

> Actualizar al cerrar cada bloque y antes de interrumpir el trabajo. Al retomar: leer este archivo, `decisiones.md`
> y los hallazgos del bloque en curso; no depender de un resumen de conversación.

**Rama**: `main` (la rama `feat/whaapy-mcp-migration` se integró por fast-forward el 12-oct; Alex pidió trabajar siempre en `main`).
**Último bloque cerrado**: B6 + B7 + B7b en producción (12-oct, ejecutado por Alex): migraciones hasta `20261013140000`, funciones `case-actions`, `messaging-admin`, `findmed-events-worker`, `findmed-mcp` (9 tools), `whaapy-inbound`, `dispatch-webhook`; secret `WHAAPY_API_KEY`. Los 8 eventos siguen con dueño n8n.
**Bloque en curso**: B9 — pruebas con el número de prueba de Alex (en `.env.local`, no versionado) siguiendo `pruebas.md`; observabilidad en `/admin/agente-ia`.

**13-oct — Corte de mensajería (B10, decidido por Alex)**: migración `20261013180000` pone todos los eventos con dueño FindMed (envío directo por la API de WHAAPY) y pausa los 8 webhooks de n8n. WHAAPY ya manda sus eventos a `whaapy-inbound` (botones y recibos llegando el 13-oct). Falta: aplicar la migración (`db push`), desactivar los workflows de n8n y quitar en WHAAPY el webhook que apunta a n8n; crear la plantilla de "cancelada por FindMed" (hoy no se avisa al paciente, igual que con n8n). Panel reorganizado en módulos (Inicio, Agenda, Doctores, Casos, WhatsApp, Automatización + Configuración en el engrane).

## Siguiente acción concreta
1. Verificado tras el deploy: 8 rutas (todas n8n), 14 pasos, 7 crons activos, worker respondió 200 y procesó 7 eventos de WHAAPY sin error, sondeos sin credencial = 401, MCP lista 9 tools, `types.ts` regenerado desde producción.
2. B8 hecho: `agente/prompt-findi-v2.md` + `agente/README.md`. Catálogo de triaje recibido y reconstruido como v2 (N31, D12); prompt v2.3 corrige la primera parada (N32). Falta: aprobación de urgencias (D7), revisión médica del catálogo, aplicar migración `20261013170000` (columnas v2) + importar, re-sincronizar herramientas y pegar v2.3 en WHAAPY.
3. Corte gradual (B10): eventos sin botones primero (EV02, EV04, EV08, EV01 reservada/completada), luego los de botones junto con el agente y la automatización "Omitir IA" (A6).

## Pendientes de prueba
`npm run test:edge`: 89 passed (12-oct). Mapeo sembrado validado 14/14 contra las 37 plantillas reales. IR de R18/R25/R29/R30/R31/R33 bloqueadas por número/contacto WHAAPY de prueba.

## Bloqueos y decisiones necesarias

| Tipo | Detalle | Quién | Bloquea |
|---|---|---|---|
| Acceso | Token de la cuenta FindMed en `.env.local`, usado solo por `scripts/sb.sh` | — | resuelto |
| Permisos | `.claude/settings.local.json` creado con permiso para `bash scripts/sb.sh` (autorizado por Alex 12-oct) | — | resuelto |
| Permisos | El clasificador de Claude Code bloquea `db push` a producción aunque pase por `sb.sh`: Alex lo ejecuta o agrega una regla explícita | Alex | Migración B6 |
| Seguridad | Rotar key legacy (Vault → `sb_secret_`, desactivar legacy, revocar JWT secret) | Alex + Claude | N01 |
| Seguridad | Reset de las ~52 contraseñas expuestas | Alex/FindMed | N02 |
| Clínico | Revisión del catálogo de triaje v2 (115 condiciones, 0 validadas) y respaldo de Medicina Interna para especialidades sin médicos (D12) | Responsable clínico FindMed | Uso de `suggest_specialty` en producción |
| WHAAPY | Número/contactos de prueba, token API, acceso a configurar agente/automatizaciones | Alex | B5 (IR), B6, B7, B8 |
| Negocio | Cobertura real de ciudades (prompt: CDMX+QRO; catálogo: 9) | FindMed | R07, prompt B8 |
| Negocio | Texto y reglas de urgencia aprobados | Responsable clínico FindMed | R08, B8 |
| Negocio | Alcance del servicio de ambulancias y del menú de bienvenida (17 nodos "pendiente") | FindMed | B8 |
| Negocio | EV05 (día de vs "mañana") y EV07 (solicitud vs envío) | FindMed | B7 |
| Negocio | Regla de escalación de casos sin tomar (horario, tiempos por prioridad, a quién avisar) | FindMed operación | B6 (escalación), R32 |
| Documentación | Especificación Findi v2.0 / T01–T30 | Alex | B9 |

## Bitácora de bloques

| Fecha | Bloque | Resultado | Evidencia |
|---|---|---|---|
| 12-oct | Previo (main) | Seguridad, agenda, crons, keys, docs; `seed-admin` eliminada en prod | commits en `main` hasta `9ed5aa5`; `hallazgos.md` N01–N10 |
| 12-oct | B2-bis | Exclusión por doctor (D2), 23P01→409 en 6 funciones, URL de crons en Vault | `bf5b437`, pruebas PGlite |
| 12-oct | B1 | `_shared/care-search.ts`, alias de ciudad, none/one/many, validación de teléfono | `7ffe2f6`, `da12774` |
| 12-oct | B4 (parte 1) | `appointment-actions`, `calendar-sync`, `events`, `day-slots`, `booking-session` | `23562f1`, `70fa716`, `8849952` |
| 12-oct | Deploy prod | 4 migraciones, 44 funciones, `FINDMED_MCP_TOKEN` y `WHAAPY_WEBHOOK_SECRET`, sondeos 401 OK | P-008, R29/R30/R36 IR |
| 12-oct | B4 (parte 2) | `operation_requests` (migración `20261013100000`), `_shared/operations.ts`, tools prepare/commit/estado; commit por chat detrás de flag | ver commit de B4-2 |
| 12-oct | B5 (fase lectura) | `findmed-mcp` con 4 tools + guía WHAAPY | ver commit de B5 |
| 12-oct | B0 | Lectura completa del plan (1,407 líneas) y del export (117 nodos); diagnóstico, D1–D4, A1–A9, cobertura, inventario de nodos, suite de pruebas | archivos de `docs/findmed-migration/` |
| 12-oct | N29 | Crons en 401 tras el deploy → credencial dedicada `FINDMED_CRON_SECRET`; corrida 23:30 UTC = 200 | `5c815cc`, `net._http_response` |
| 12-oct | B6 | `patient_cases` + `case_events` (migración `20261013130000`), `_shared/cases.ts`, `_shared/whaapy-client.ts`, Edge Function `case-actions`, tools `open_case`/`request_handoff`/`get_my_case_status`, vista `/admin/casos` | `aa3c602`, `b150bc5`, `cases_test.ts` |
| 12-oct | B7 | `message_routes`/`message_route_steps`/`domain_outbox`/`message_deliveries` (migración `20261013140000`), `dispatch-webhook` con dueño por evento, `_shared/messaging.ts`, `_shared/whaapy-events.ts`, `findmed-events-worker`, `whaapy-inbound` procesa recibos y botones | `46c4bbd`, `messaging_test.ts` |
| 12-oct | B7b | `messaging-admin` + `/admin/mensajeria` (eventos, envíos, plantillas) | `994c1b2`, `2bbb259`, `messaging-admin_test.ts` |
| 12-oct | Deploy B6/B7 | Alex ejecutó `db push` + secret + 6 funciones (comando único en PowerShell); verificación posterior OK | `97cbd3a` (types) |
| 12-oct | Observabilidad | `mcp_requests` (migración `20261013150000`), registro en `findmed-mcp`, acción `health`, página `/admin/agente-ia` (conexión, actividad, errores, guía) | `3e82d5e`, `e9abf20` |
| 12-oct | B8 | Prompt FINDI v2 y guía de configuración del agente en WHAAPY | `docs/findmed-migration/agente/` |
