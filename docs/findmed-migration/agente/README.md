# Configurar el agente FINDI en WHAAPY (bloque B8)

Guía paso a paso para dejar el agente nativo de WHAAPY conectado a FindMed. Sin secretos en este archivo.
El estado de cada paso se ve en FindMed → Configuración → **Agente IA**.

## 1. Conector MCP

En WHAAPY → Agente → MCPs → agregar:

| Campo | Valor |
|---|---|
| URL | `https://jyzvdowflblxmlahlupo.supabase.co/functions/v1/findmed-mcp` |
| Autenticación | Bearer → el valor de `FINDMED_MCP_TOKEN` (en `.env.local` del equipo técnico; nunca en chats ni docs) |

"Probar conexión" debe mostrar 10 herramientas. En FindMed → Agente IA aparece "WHAAPY probó la conexión con
el MCP". Si aparece "token inválido", el valor pegado no coincide.

## 2. Campos fijos de cada herramienta

En "Configurar tool", el campo `phone` va **fijo** a `{{contact.phoneNumber}}` en: `create_booking_link`,
`list_my_appointments`, `prepare_appointment_action`, `get_operation_status`, `open_case`, `request_handoff`,
`get_my_case_status`. En `open_case`, `contact_name` puede ir a `{{contact.name}}`. El resto de los campos
los llena la IA. Ver detalle en `../whaapy-mcp-config.md`.

## 3. Instrucciones del agente

Pegar el contenido completo de `FINDI-prompt.txt` (Ctrl+A, Ctrl+C).
Motor recomendado: `colme-2` (herramientas, MCPs y handoff).

## 4. Automatizaciones de WHAAPY

| Automatización | Por qué |
|---|---|
| "Omitir IA" cuando el botón empiece con `confirmar_cita:` o `cancelar_cita:` | FindMed procesa esos botones; la IA no debe contestarlos también (A6). |
| Ninguna otra que pause la IA o asigne agentes en handoff | El dueño único es FindMed (`request_handoff` + `/admin/casos`, A7). |

## 5. Equipo

El correo de cada asesor en WHAAPY debe ser el mismo que su usuario de FindMed: así "Tomar caso" en
`/admin/casos` también asigna la conversación en WHAAPY.

## 6. Prueba antes de operar

Con el número de prueba, seguir el guion de `../pruebas.md` (R01–R13, R29–R32) y revisar cada paso en
FindMed → Agente IA → Actividad. Solo después se hace el corte (B10).
