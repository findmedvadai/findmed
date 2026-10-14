# Estado de ejecución

> Actualizar al cerrar cada bloque y antes de interrumpir el trabajo. Al retomar: leer este archivo, `decisiones.md`
> y los hallazgos del bloque en curso; no depender de un resumen de conversación.

**Rama**: `main` (la rama `feat/whaapy-mcp-migration` se integró por fast-forward el 12-oct; Alex pidió trabajar siempre en `main`).
**Último bloque cerrado**: Revisión integral y cierre de Etapa 1/2 (13–14 oct), en `main` sin desplegar: alertas y escalamiento de casos (`20261014110000`), rutas post-consulta y reembolsos (`20261014120000`), seguro/documentos/red hospitalaria y FINDI v2.5 (`20261014130000`, 13 tools), documentos solo en primera reserva (`20261014100000`), calendario paginado y día completo, alta de médico atómica, state OAuth firmado, PasswordGate sin contraseña fija. Corte de mensajería `20261013180000` ya aplicado en prod (8 eventos FindMed, 0 webhooks n8n activos). Entregable al cliente: manual y acta en `entrega.local/manual/` (no versionado).
**Estado observado en producción (14-oct, auditoría de construcción, solo lectura)**: migraciones aplicadas hasta `20261014150000` (35/35 del repo en ese momento, sin huecos ni versiones remotas desconocidas); las 49 funciones desplegadas a las 17:01 UTC (versión 1 de `triage-admin`) y **byte a byte iguales a `main` en `cdcadf9`** (descargadas con `functions download` y comparadas); `verify_jwt` desplegado = `config.toml` (35 explícitas en `false`, 14 por defecto en `true`, ahora también declaradas); `types.ts` regenerado desde producción = el del repo salvo orden. Lo pendiente de desplegar es solo lo que se cambió después de ese commit (ver bitácora 14-oct).
**Despliegue anterior (hecho)**: `db push` (100000–150000) → `functions deploy` (todas) → push de `main`. Luego en WHAAPY: pegar FINDI v2.5, sincronizar 13 tools, fijar `phone` de `save_patient_insurance`, crear plantilla `alerta_caso_findmed` (texto en `agente/plantilla-alerta-casos.md`); en el panel: números de guardia.
**Bloque en curso**: B9 — pruebas con el número de prueba de Alex (en `.env.local`, no versionado) siguiendo `pruebas.md`; observabilidad en `/admin/agente-ia`.

**13-oct — Corte de mensajería (B10, decidido por Alex)**: migración `20261013180000` pone todos los eventos con dueño FindMed (envío directo por la API de WHAAPY) y pausa los 8 webhooks de n8n. WHAAPY ya manda sus eventos a `whaapy-inbound` (botones y recibos llegando el 13-oct). Falta: aplicar la migración (`db push`), desactivar los workflows de n8n y quitar en WHAAPY el webhook que apunta a n8n; crear la plantilla de "cancelada por FindMed" (hoy no se avisa al paciente, igual que con n8n). Panel reorganizado en módulos (Inicio, Agenda, Doctores, Casos, WhatsApp, Automatización + Configuración en el engrane).

## Siguiente acción concreta
1. Verificado tras el deploy: 8 rutas (todas n8n), 14 pasos, 7 crons activos, worker respondió 200 y procesó 7 eventos de WHAAPY sin error, sondeos sin credencial = 401, MCP lista 9 tools, `types.ts` regenerado desde producción.
2. B8 hecho: `agente/prompt-findi-v2.md` + `agente/README.md`. Catálogo de triaje recibido y reconstruido como v2 (N31, D12); prompt v2.3 corrige la primera parada (N32). Falta: aprobación de urgencias (D7), revisión médica del catálogo, aplicar migración `20261013170000` (columnas v2) + importar, re-sincronizar herramientas y pegar v2.3 en WHAAPY.
3. Corte gradual (B10): eventos sin botones primero (EV02, EV04, EV08, EV01 reservada/completada), luego los de botones junto con el agente y la automatización "Omitir IA" (A6).

## Pendientes de prueba
14-oct: `npm run test` 18 archivos / 80 pruebas, `npm run test:edge` 277 passed, `deno check` de `supabase/functions` 0 errores, `eslint .` 0 errores (8 avisos de shadcn/useAuth), `tsc` 0. Cobertura por área y huecos en [cobertura.md](cobertura.md). (12-oct: `test:edge` 89 passed.) Mapeo sembrado validado 14/14 contra las 37 plantillas reales. IR de R18/R25/R29/R30/R31/R33 bloqueadas por número/contacto WHAAPY de prueba.

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
| 14-oct | Auditoría de construcción | Prod = `main@cdcadf9` (49 funciones idénticas, migraciones hasta 150000, `verify_jwt` coincide). `deno check` 138 → 0 errores (selects en un literal, casts de embebidos, rollback de credenciales), lint 24 → 0, bundle inicial 1.47 MB → ~0.53 MB (gzip 412 → ~161 kB) con code-splitting por ruta + chunks de vendors, `config.toml` con las 49 funciones. Sin desplegar: requiere `functions deploy` de las 21 funciones tocadas por la auditoría (admin-cancel/create/reschedule-appointment, auto-cancel-unconfirmed, auto-complete-appointments, cancel-by-doctor, dispatch-webhook, doctor-create/reschedule-appointment, doctor-office-delete/update, generate-manage-link, google/outlook-calendar-events y -list, manage-reschedule, reserve-create, send-appointment-reminders, send-day-of-reminders, update-doctor-credentials) y de las 6 de eventos de calendario (`google/outlook-calendar-create/update/delete-event`) que importan `_shared/office-resolver.ts`, más lo que agreguen los frentes de seguridad y lógica (migraciones 160000/170000 primero). | ERRORES.md 14-oct, cobertura.md |

### Riesgos de arquitectura (14-oct)
- **Dependencias sin fijar**: 85 imports `esm.sh/@supabase/supabase-js@2` (hoy resuelve a 2.117.3; el frontend usa 2.95.3) y `create-doctor` fijado a 2.49.4: cada deploy puede empaquetar otra versión. Propuesta: `supabase/functions/deno.json` con import map (`npm:@supabase/supabase-js@<exacta>`) y redeploy de todas, probado antes.
- **`deno.land/std@0.168.0` `serve`** en las 14 funciones de calendario (el resto usa `Deno.serve`).
- **Duplicación**: `admin-` vs `doctor-create-appointment` (~75 % igual) y `-reschedule-` (~80 %); creación/edición de eventos Google/Outlook inline en 10 funciones (solo el borrado está en `_shared/calendar-sync.ts`). Un fix de calendario hay que replicarlo a mano.
- **`verify_jwt` inconsistente** entre gemelas: `google-calendar-create/update/delete-event` en `true`, las de Outlook en `false` (ambas verifican el JWT en código).
- **Sin pruebas** de los handlers de reserva/reagenda del paciente, de citas por staff y de los crons (cobertura.md).
