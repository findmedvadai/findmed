# Decisiones

Cada decisión registra: quién decide, evidencia, alternativas, desventajas que conserva y qué la haría cambiar.

## Decisiones de negocio (Alex, 12-oct-2026)

| ID | Decisión | Efecto en el trabajo |
|---|---|---|
| D1 | Todo opera exclusivamente en el proyecto Supabase nuevo `jyzvdowflblxmlahlupo`. | El export de n8n (que llama a `iepdgygvztocornqkkhk`) se trata como referencia histórica. No se migra nada del proyecto viejo. Antes del corte se confirma que ningún workflow activo apunta al viejo. |
| D2 | Un doctor no puede tener dos citas simultáneas, aunque sean en consultorios distintos. | Exclusión por `doctor_id` en la migración `20261012120000` (no aplicada aún → se modifica antes de aplicar). `validateSlotAvailable` y `reserve-slots` evalúan citas del doctor en todas sus sedes. Antes de aplicar se revisan solapamientos existentes sin borrar citas. |
| D3 | `users.initial_password` se mantiene por ahora. | Riesgo aceptado: contraseñas iniciales en texto plano visibles para admins y el propio doctor. No se tocan login, alta ni UI de credenciales. Reabrir cuando se priorice. |
| D4 | n8n desaparecerá por completo del flujo. | Ningún componente nuevo depende de n8n ni de API keys `fm_` para el agente. Las funciones de n8n que no llama el export (`generate-manage-link`, `confirm-appointment`) pueden desplegarse cerradas. |

## Decisiones técnicas

### A1 · Ubicación del MCP: Supabase Edge Function `findmed-mcp`
- **Evidencia**: WHAAPY exige Streamable HTTP, JSON-RPC 2.0, MCP `2025-06-18`, timeouts 15 s (initialize/list) y 30 s (call), y acepta respuesta JSON (envía `Accept: application/json, text/event-stream`) [DOC `/guides/mcp-server-spec`]. Las Edge Functions ya alojan todo el dominio y sus helpers `_shared/`.
- **Alternativas**: (a) servicio separado (Node/Vercel/Cloud Run): más infraestructura, secretos y despliegue duplicados; (b) SDK oficial o `mcp-lite` dentro de Deno: más dependencias por esm.sh para 4 métodos JSON-RPC.
- **Elegida**: handler JSON-RPC propio y pequeño, stateless (sin `Mcp-Session-Id`), respuestas `application/json`, notificaciones → 202 sin body.
- **Desventajas**: mantener el protocolo a mano; cold starts.
- **Cambiaría si**: el cliente real de WHAAPY exige SSE o sesión persistente, o la latencia de cold start supera el presupuesto de 15 s.

### A2 · Autenticación e identidad del MCP
- **Evidencia**: WHAAPY soporta `bearer`, `api_key` o headers propios. Para campos de tools solo documenta variables `contact.name/first_name/phoneNumber/email` [DOC `/guides/agent-mcps`, `/guides/automations/variables`] (N21).
- **Elegida**: bearer dedicado por entorno (`FINDMED_MCP_TOKEN`, secreto de función, comparación en tiempo constante). El campo `phone` de cada tool se mapea en WHAAPY a `{{contact.phoneNumber}}`; el servidor lo normaliza con `_shared/phone.ts` y filtra todo por ese paciente.
- **Supuesto explícito**: la identidad del paciente es tan confiable como el token de la integración WHAAPY; el modelo no puede cambiar un campo mapeado a variable.
- **Cambiaría si**: el selector real expone `contact.id`/`conversation.id` (se agregan como segundo factor) o si WHAAPY permite que la IA sobrescriba campos mapeados.

### A3 · Granularidad de herramientas (consolidación de M01–M11)
`search_care_options` (M01) · `list_available_slots` (M03) · `create_booking_link` (M04) · `list_my_appointments` (M05) · `prepare_appointment_action` + `commit_appointment_action` (M06/M07) · `get_operation_status` (M08) · `open_case` + `request_handoff` (M09/M10) · `get_my_case_status` (M11) · `suggest_specialty` (M02, solo tras F10).
- Campos de contacto (aseguradora, ciudad, zona…) usan la herramienta nativa de campos de WHAAPY, no tools MCP.
- Sin SQL libre, sin HTTP genérico, sin herramientas de administración.

### A4 · Confirmación auténtica de acciones
- `prepare_appointment_action` crea una intención (acción, appointment_id/slot, hash, vencimiento) ligada al teléfono; `commit` la consume una vez.
- **Evidencia válida de confirmación**: (1) botón quick-reply con payload propio (N24) recibido por `whaapy-inbound`, o (2) el enlace seguro `/gestionar`. Un `confirmed=true` escrito por el modelo **no** basta.
- Hasta probar (1) en número real, las mutaciones por chat quedan apagadas por feature flag y se ofrece el enlace `/gestionar`.

### A5 · Eventos y mensajería: outbox + worker
- **Evidencia**: las automatizaciones de WHAAPY se disparan por eventos de WHAAPY, no por cambios en la BD de FindMed [DOC `/guides/automations/*`]; la API de envío no documenta idempotency key (N23); hay recibos `message.delivered/read/failed` [DOC webhooks/events].
- **Elegida**: tabla `domain_outbox` insertada por los productores actuales, worker `findmed-events-worker` (pg_cron por minuto, claim con lease), tabla `message_deliveries` con estado incierto cuando se pierde la respuesta. Flag `event_owner` (`n8n` | `worker`) por tipo de evento para que haya un único dueño durante la transición.
- **Desventajas**: entrega al menos una vez; posibles duplicados ante respuesta perdida (mitigado con reconciliación).
- **Cambiaría si**: WHAAPY expone idempotencia o disparadores por webhook entrante con garantías equivalentes.

### A6 · Botones confirmar/cancelar
- Payload `{acción, appointment_id, nonce}` → webhook WHAAPY `message.received` → Edge Function `whaapy-inbound` (verificación HMAC según N20) → `_shared/appointment-actions.ts`. Una automatización WHAAPY con "Omitir IA" evita que el agente responda al mismo botón.
- **Pendiente de prueba real**. Alternativa vigente: botones URL a `/gestionar?token=` (ya usados por los templates actuales).

### A7 · Casos y handoff
- No existe entidad equivalente (Inbox = notificaciones). Nuevas tablas `patient_cases` + `case_events` con RLS de admin.
- `request_handoff` persiste el caso, busca la conversación por teléfono (`/conversations/v1/by-phone`), pausa la IA (`POST /conversations/v1/{id}/ai/pause`) y asigna. Devuelve `assigned` solo con confirmación; si no, `awaiting_assignment`.

### A8 · Agenda: restricción en BD
- Exclusión GiST `(doctor_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&)` para `scheduled|confirmed` (D2) + `CHECK end_at > start_at`. Las Edge Functions mapean `23P01` → 409.
- **Cambiaría si**: aparecen solapamientos legítimos existentes que FindMed quiera conservar (se resolverían caso por caso antes de aplicar).

### A9 · Flujo de ramas y producción
- Trabajo en `feat/whaapy-mcp-migration`, commits atómicos. Producción (migraciones, funciones, Vault, WHAAPY) solo con indicación explícita de Alex y con el runbook de B10.
