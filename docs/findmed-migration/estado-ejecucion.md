# Estado de ejecución

> Actualizar al cerrar cada bloque y antes de interrumpir el trabajo. Al retomar: leer este archivo, `decisiones.md`
> y los hallazgos del bloque en curso; no depender de un resumen de conversación.

**Rama**: `feat/whaapy-mcp-migration` (desde `main` = `9ed5aa5`).
**Último bloque cerrado**: B6 — casos y canalización humana (código, pruebas y vista admin; migración y deploy pendientes de OK de Alex).
**Bloque en curso**: B7 — outbox + worker de plantillas, procesamiento de `whaapy_events` y botones; después B7b (centro de mensajería).

## Siguiente acción concreta
1. Alex: autorizar (o ejecutar) en producción la migración `20261013130000_patient_cases.sql`, el secret `WHAAPY_API_KEY`/`WHAAPY_API_BASE_URL` para funciones y el deploy de `case-actions` + `findmed-mcp`. Después: regenerar `types.ts`.
2. B7: `domain_outbox` + `message_deliveries`, worker con plantillas reales, `emitEvent` → outbox, procesar `whaapy_events` (recibos, `conversation.assigned`, botones).
3. B7b: centro de mensajería en el admin (plantillas por API, evento→plantilla, historial, reenvío).

## Pendientes de prueba
`npm run test:edge`: 65 passed (12-oct, incluye `cases_test.ts`). IR de R18/R25/R29/R30/R31 bloqueadas por número/contacto WHAAPY de prueba.

## Bloqueos y decisiones necesarias

| Tipo | Detalle | Quién | Bloquea |
|---|---|---|---|
| Acceso | Token de la cuenta FindMed en `.env.local`, usado solo por `scripts/sb.sh` | — | resuelto |
| Permisos | `.claude/settings.local.json` creado con permiso para `bash scripts/sb.sh` (autorizado por Alex 12-oct) | — | resuelto |
| Permisos | El clasificador de Claude Code bloquea `db push` a producción aunque pase por `sb.sh`: Alex lo ejecuta o agrega una regla explícita | Alex | Migración B6 |
| Seguridad | Rotar key legacy (Vault → `sb_secret_`, desactivar legacy, revocar JWT secret) | Alex + Claude | N01 |
| Seguridad | Reset de las ~52 contraseñas expuestas | Alex/FindMed | N02 |
| Acceso | Host y permisos del Postgres Vadai (`triage_findmed`) | Alex | M02, F10 |
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
