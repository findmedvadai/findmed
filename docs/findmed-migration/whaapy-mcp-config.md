# Configurar el MCP de FindMed en WHAAPY

Guía para el ambiente de **prueba** (número/contactos de prueba). No activar con pacientes reales hasta aprobar
R29–R31 y el bloque 9. Sin secretos en este documento.

## 1. Desplegar y fijar el token (Alex)

```
# Genera un token largo y aleatorio (no lo pegues en chats ni docs)
openssl rand -base64 48

npx supabase secrets set FINDMED_MCP_TOKEN=<token> --project-ref jyzvdowflblxmlahlupo
npx supabase functions deploy findmed-mcp --project-ref jyzvdowflblxmlahlupo --use-api
```

`verify_jwt = false` ya está en `supabase/config.toml`: la función valida el bearer en código y responde 401 si falta,
no coincide o el secret no está configurado (falla cerrado).

## 2. Conector en WHAAPY (tab `MCPs` del agente)

| Campo | Valor |
|---|---|
| URL | `https://jyzvdowflblxmlahlupo.supabase.co/functions/v1/findmed-mcp` |
| Autenticación | `bearer` → el valor de `FINDMED_MCP_TOKEN` |
| Motor del agente | `colme-2` (tools, MCPs, batching, handoff) |

Prueba de conexión: WHAAPY hace `initialize` + `tools/list`; deben aparecer 10 tools (11 con `MCP_CHAT_ACTIONS_ENABLED=true`).

## 3. Tools habilitadas y mapeo de campos

| Tool | Seguridad | Campo | Valor en "Configurar tool" |
|---|---|---|---|
| `search_care_options` | lectura | specialty, city, zone | vacío (la IA los toma de la conversación) |
| `list_available_slots` | lectura | office_id, date, days | vacío |
| `create_booking_link` | escritura limitada (crea sesión de reserva) | **phone** | **`{{contact.phoneNumber}}`** (obligatorio) |
| | | patient_name, doctor_id, office_id, symptoms | vacío |
| `list_my_appointments` | lectura privada | **phone** | **`{{contact.phoneNumber}}`** (obligatorio) |
| `prepare_appointment_action` | lectura privada (registra intención) | **phone** | **`{{contact.phoneNumber}}`** (obligatorio) |
| | | appointment_id, action | vacío |
| `get_operation_status` | lectura privada | **phone** | **`{{contact.phoneNumber}}`** (obligatorio) |
| `open_case` | escritura limitada (crea caso) | **phone** | **`{{contact.phoneNumber}}`** (obligatorio) |
| | | request_type, summary, priority, city, zone | vacío |
| | | contact_name | `{{contact.name}}` (opcional) |
| `request_handoff` | escritura limitada (apaga la IA de esa conversación) | **phone** | **`{{contact.phoneNumber}}`** (obligatorio) |
| | | case_id, reason, priority | vacío |
| `get_my_case_status` | lectura privada | **phone** | **`{{contact.phoneNumber}}`** (obligatorio) |

Nunca dejes `phone` vacío: la IA podría inventarlo o tomar el de otra persona. La identidad del paciente es tan confiable
como este mapeo (decisión A2).

Pendientes antes de habilitar acciones de confirmar/cancelar por chat (M06/M07): ver `decisiones.md` A4/A6.

**Handoff (B6)**: `request_handoff` y `/admin/casos` llaman a la API de WHAAPY con el secret de funciones
`WHAAPY_API_KEY` (scopes necesarios: conversaciones lectura/escritura, contactos escritura, equipo lectura).
Para que "Tomar caso" asigne también en WHAAPY, el correo del usuario de FindMed debe ser el mismo que el del
agente en el equipo de WHAAPY. No crear en WHAAPY otra automatización que pause o asigne en handoff: el dueño
único es FindMed (`decisiones.md` A7).

## 4. Pruebas mínimas en número de prueba (registrar en `pruebas.md`)

| Prueba | Esperado |
|---|---|
| "Busco ortopedista en CDMX" | `search_care_options` con result one/many; si hay varias opciones el agente pide elegir (R02, R03) |
| Ciudad ambigua o desconocida | `needs_more_info` + pregunta; el agente no dice "no atendemos" (R05, R06) |
| Elegir opción y nombre | `create_booking_link` devuelve `reserve_url`; el agente dice "aquí puedes elegir tu horario", no "tu cita quedó" (R13) |
| "¿Cuándo es mi cita?" | `list_my_appointments` solo con citas de ese número (R10, R28) |
| Token inválido en el conector | WHAAPY muestra error de conexión (R30) |
| Corte de red / función caída | el agente ofrece canalizar con asesor, no inventa (R30) |
| "Quiero hablar con una persona" | `open_case` + `request_handoff` → `awaiting_assignment`; el agente dice que una persona de FindMed tomará su solicitud, sin prometer tiempo; la IA deja de responder (R31) |
| Mensaje del paciente tras el handoff | la IA no contesta (apagada en esa conversación); el caso aparece en `/admin/casos` (R31) |
| "¿Qué pasó con mi solicitud?" | `get_my_case_status` con frase para el paciente, sin notas internas (R10) |
