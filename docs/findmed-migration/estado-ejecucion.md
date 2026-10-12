# Estado de ejecución

> Actualizar al cerrar cada bloque y antes de interrumpir el trabajo. Al retomar: leer este archivo, `decisiones.md`
> y los hallazgos del bloque en curso; no depender de un resumen de conversación.

**Rama**: `feat/whaapy-mcp-migration` (desde `main` = `9ed5aa5`).
**Último bloque cerrado**: B5 fase lectura — `findmed-mcp` (12-oct-2026). Antes: B0, B2-bis, B1, B4 parte 1.
**Bloque en curso**: B4 parte 2 — idempotencia (`operation_requests`) y prepare/commit para acciones por chat; luego B6 (casos/handoff) y B7 (outbox).

## Siguiente acción concreta
1. B4 parte 2: tabla `operation_requests` (idempotencia por operación) + `prepare_appointment_action` / `commit_appointment_action` detrás de feature flag (A4).
2. B6: `patient_cases` + `case_events`, tools `open_case` / `request_handoff` / `get_my_case_status`.
3. B7: `domain_outbox` + worker + `whaapy-inbound` (cambiar el cuerpo de `_shared/events.ts`).
4. Cuando vuelva el acceso Owner: aplicar migración `20261012120000`, desplegar funciones (runbook B10) y probar el MCP en número WHAAPY de prueba (`whaapy-mcp-config.md`).

## Pendientes de prueba
`npm run test:edge`: 36 passed (12-oct). IR de R18/R25/R29/R30 bloqueadas por acceso a Supabase y número WHAAPY de prueba.

## Bloqueos y decisiones necesarias

| Tipo | Detalle | Quién | Bloquea |
|---|---|---|---|
| Acceso | 403 en Supabase `jyzvdowflblxmlahlupo` | Alex | Verificación de prod, migraciones, deploy |
| Permisos | Reglas para `functions deploy`, `db push`, `git push --force` | Alex | Deploy desde Claude Code |
| Seguridad | Rotar key legacy (Vault → `sb_secret_`, desactivar legacy, revocar JWT secret) | Alex + Claude | N01 |
| Seguridad | Reset de las ~52 contraseñas expuestas | Alex/FindMed | N02 |
| Acceso | Host y permisos del Postgres Vadai (`triage_findmed`) | Alex | M02, F10 |
| WHAAPY | Número/contactos de prueba, token API, acceso a configurar agente/automatizaciones | Alex | B5 (IR), B6, B7, B8 |
| Negocio | Cobertura real de ciudades (prompt: CDMX+QRO; catálogo: 9) | FindMed | R07, prompt B8 |
| Negocio | Texto y reglas de urgencia aprobados | Responsable clínico FindMed | R08, B8 |
| Negocio | Alcance del servicio de ambulancias y del menú de bienvenida (17 nodos "pendiente") | FindMed | B8 |
| Negocio | EV05 (día de vs "mañana") y EV07 (solicitud vs envío) | FindMed | B7 |
| Documentación | Especificación Findi v2.0 / T01–T30 | Alex | B9 |

## Bitácora de bloques

| Fecha | Bloque | Resultado | Evidencia |
|---|---|---|---|
| 12-oct | Previo (main) | Seguridad, agenda, crons, keys, docs; `seed-admin` eliminada en prod | commits en `main` hasta `9ed5aa5`; `hallazgos.md` N01–N10 |
| 12-oct | B2-bis | Exclusión por doctor (D2), 23P01→409 en 6 funciones, URL de crons en Vault | `bf5b437`, pruebas PGlite |
| 12-oct | B1 | `_shared/care-search.ts`, alias de ciudad, none/one/many, validación de teléfono | `7ffe2f6`, `da12774` |
| 12-oct | B4 (parte 1) | `appointment-actions`, `calendar-sync`, `events`, `day-slots`, `booking-session` | `23562f1`, `70fa716`, `8849952` |
| 12-oct | B5 (fase lectura) | `findmed-mcp` con 4 tools + guía WHAAPY | ver commit de B5 |
| 12-oct | B0 | Lectura completa del plan (1,407 líneas) y del export (117 nodos); diagnóstico, D1–D4, A1–A9, cobertura, inventario de nodos, suite de pruebas | archivos de `docs/findmed-migration/` |
