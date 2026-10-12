# Estado actual del sistema

Fecha de revisión: 12-oct-2026. Sin secretos ni datos de pacientes.

## Ambientes y referencias

| Elemento | Valor | Nota |
|---|---|---|
| Repositorio | `findmedvadai/findmed` (público) | Historial reescrito el 12-oct para purgar secretos; `main` = `9ed5aa5` local y remoto. |
| Commit auditado por el plan | `cef120f` | Ya no existe tras la reescritura; equivale a `feat: registro durable de auto/manual-disconnect…`. |
| Supabase vigente | `jyzvdowflblxmlahlupo` | Único proyecto de trabajo (D1). Acceso de Alex en 403 desde la tarde del 12-oct; pendiente restaurar Owner. |
| Supabase anterior | `iepdgygvztocornqkkhk` | Referenciado por el export n8n. Fuera de alcance por D1; no borrar sin inventario. |
| Frontend | Vercel → `app.findmed.com.mx` | El push a `main` no despliega Edge Functions ni migraciones. |
| n8n | `automation.vadai.com.mx` | Se retirará por completo (D4). Export de referencia sin ID/versión/estado. |
| Postgres "Vadai" | credencial de n8n | Contiene `triage_findmed` y la memoria de chat (F10). Sin acceso. |
| WHAAPY | negocio FindMed | Docs oficiales revisadas el 12-oct. Configuración real del agente/automatizaciones no inspeccionada. |

## Mapa del sistema (resumen)

- **Frontend** (React 18 + Vite + shadcn + TanStack Query): admin (calendario, reservas, doctores, catálogos, inbox, webhooks, API keys), doctor (agenda, configuración, por completar, inbox), paciente sin cuenta (`/reserva?token`, `/gestionar?token`), landing y legales.
- **Backend**: Supabase Auth + Postgres con RLS + 43 Edge Functions (Deno). Helpers en `supabase/functions/_shared/`.
- **Agenda**: `doctor_offices` es la autoridad (calendario, duración, disponibilidad). Google/Outlook por consultorio con refresh token rotado y bitácora `calendar_connection_events`.
- **Mensajería**: los productores llaman a `dispatch-webhook`, que firma HMAC y hace POST a 8 webhooks de n8n; n8n envía templates por WHAAPY.
- **Agente**: nodo FINDI de n8n (modelo vía OpenRouter, memoria Postgres Vadai, SQL libre sobre `triage_findmed`, 11 tools de campos WHAAPY).
- **Crons** (pg_cron + pg_net, key en Vault `service_role_key`): recordatorio 48 h (`5 * * * *`), día de (`0 14 * * *` = 08:00 CDMX), auto-cancelar (`*/15`), auto-completar (`*/15`).

## Deploy: qué hay en cada lugar

| Componente | En `main` | En producción |
|---|---|---|
| Frontend | `9ed5aa5` (incluye Gestionar con office_id y CSPRNG en API keys/secrets) | Vercel despliega desde `main` (no verificado en esta sesión). |
| Edge Functions | Rama `feat/whaapy-mcp-migration` | **44 funciones desplegadas desde la rama** (12-oct ~23:08 UTC), incluidas `findmed-mcp` y `whaapy-inbound`; `seed-admin` eliminada. |
| Migraciones | hasta `20261013120000` | **hasta `20261013120000`** (12-oct): exclusión por doctor, URL de crons en Vault, `operation_requests`, `whaapy_events`, purga a 12 meses. |
| Cron jobs | `20261012120000` + `20261013000000` (URL en Vault) | 4 jobs vía `invoke_edge_function` (URL literal); 27×200 en 3 h (12-oct 22:45 UTC). |
| Vault | — | `service_role_key` = **`FINDMED_CRON_SECRET`** desde 12-oct 23:17 (la llave legacy filtrada ya no está en Vault); `edge_functions_base_url`. |
| Secrets de funciones | — | `FINDMED_MCP_TOKEN`, `WHAAPY_WEBHOOK_SECRET`, `FINDMED_CRON_SECRET` (12-oct) + los previos. |
| WHAAPY | — | Webhook "FindMed - Plataforma VADAI" → `whaapy-inbound` (10 eventos, incluye `message.received`); webhook de n8n sigue activo. |

## Bloqueos de entorno

1. ~~403~~ Resuelto: token de la cuenta FindMed en `.env.local`, usado por `bash scripts/sb.sh` (la CLI global sigue con la cuenta de otros proyectos).
2. Permisos: `.claude/settings.local.json` permite `bash scripts/sb.sh` (autorizado por Alex). Producción se toca solo con su visto bueno por paso.
3. WHAAPY: API key en `.env.local` (verificada: 37 templates, 3 agentes, 1 webhook a n8n). Pendiente: crear el webhook hacia `whaapy-inbound`. Sin acceso al Postgres Vadai ni a la Especificación Findi v2.0.
