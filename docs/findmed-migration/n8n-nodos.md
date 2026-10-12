# Inventario de nodos n8n (export de referencia)

> Generado por `scripts/n8n-inventory.mjs` desde `FINDMED-N8N-Referencia-Sin-Secretos.json` (no versionado).
> Solo se muestran hosts; ninguna credencial, header ni URL completa. Regenerar si cambia el export.

**Totales:** 117 nodos · ruta principal 100 · desconectados 4 · notas 13.

**Por tipo:** agent 2 · postgresTool 2 · if 2 · switch 7 · code 1 · lmChatOpenRouter 2 · memoryPostgresChat 2 · httpRequestTool 11 · stickyNote 13 · httpRequest 18 · webhook 8 · set 6 · whaapy 40 · whaapyTrigger 1 · wait 2.

**Por decisión:** conservar 0 · reemplazar 44 · consolidar 31 · retirar 25 · pendiente 17.

Estado de ejecución de cada fila: ver la columna de requisito en `cobertura.md`. Una fila "reemplazar" solo se cierra cuando su requisito queda **validado**.

| ID | Nodo | Tipo | Ruta | Conexiones salientes | Datos | Decisión | Destino | Requisitos |
|---|---|---|---|---|---|---|---|---|
| N001 | FINDI | agent | principal | main[0]→Formato Metadata | — | reemplazar | Agente nativo WHAAPY (colme-2) + tools MCP de FindMed; prompt versionado sin METADATA. | B8, F05, F06 |
| N002 | SQL Query | postgresTool | principal | ai_tool→FINDI | — | reemplazar | Tool MCP parametrizada `suggest_specialty` sobre catálogo migrado; sin SQL libre. | M02, F09, F10 |
| N003 | IF Flujo Terminado | if | principal | main[0]→If hay mensaje; main[1]→POST - Message | — | retirar | Parser de <<<METADATA>>> y bifurcación invertida; los resultados de tools son estructurados. | F06, R12 |
| N004 | Switch | switch | principal | main[0]→Add Tag match_doctor; main[1]→Add Tag urgencia; main[2]→Add Tag apoyo_asesor; main[3]→Add Tag apoyo_asesor | — | consolidar | Ruteo absorbido por agente nativo / estados de dominio. | B8 |
| N005 | Formato Metadata | code | principal | main[0]→IF Flujo Terminado | — | retirar | Parser de <<<METADATA>>> y bifurcación invertida; los resultados de tools son estructurados. | F06, R12 |
| N006 | Gemini 2.5 flash | lmChatOpenRouter | principal | ai_languageModel→FINDI | — | reemplazar | Modelo configurado en WHAAPY. El export nombra 'Gemini 2.5 flash' pero usa otro modelo (N22). | B8, N22 |
| N007 | Postgres Chat Memory | memoryPostgresChat | principal | ai_memory→FINDI | — | reemplazar | Memoria conversacional nativa de WHAAPY; no migrar historiales de pacientes. | B8 |
| N008 | findmed_aseguradora | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | B8, §7.3 |
| N009 | findmed_numero_poliza | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | B8, §7.3 |
| N010 | findmed_vigencia_poliza | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | B8, §7.3 |
| N011 | findmed_tiempo_poliza | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | B8, §7.3 |
| N012 | findmed_tipo_de_poliza | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | B8, §7.3 |
| N013 | findmed_ciudad | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | B8, §7.3 |
| N014 | findmed_zona | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | B8, §7.3 |
| N015 | findmed_especialista | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | B8, §7.3 |
| N016 | findmed_urgencia | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | F07, B8 |
| N017 | findmed_sintomas | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | B8, §7.3 |
| N018 | findmed_nombre_completo | httpRequestTool | principal | ai_tool→FINDI | host https://api.whaapy.com | consolidar | Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo. | B8, §7.3 |
| N019 | Switch Tag Paciente | switch | principal | main[0]→Set Webhook Info3; main[1]→Set Webhook Info3; main[2]→Set Webhook Info 2 | — | consolidar | Ruteo absorbido por agente nativo / estados de dominio. | B8 |
| N020 | Sticky Note1 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N021 | Triage_Webhook | httpRequest | principal | main[0]→POST - Match Doctor | host https://iepdgygvztocornqkkhk.supabase.co | reemplazar | MCP `create_booking_link` con doctor_id + office_id elegidos; el enlace no es una cita. | M04, F02, F03, F08 |
| N022 | Webhook Estado Cita | webhook | principal | main[0]→Switch Estado | path /findmed-CambioEstado | reemplazar | EV01: outbox `domain_outbox` + worker que envía template por API WHAAPY con dueño único. | EV01, B7, F19 |
| N023 | Switch Estado | switch | principal | main[0]→POST - Mensaje Cita Reservada; main[1]→POST - Mensaje Cita Confirmada; main[2]→POST - Mensaje Cita Cancelada Paciente; main[3]→POST - Mensaje Cita Completada | — | consolidar | Mapeo evento→template en el worker de eventos. | EV01, B7 |
| N024 | Webhook Confirmación | webhook | principal | main[0]→POST - Mensaje Confirmación 48hr | path /findmed-Confirmacion | reemplazar | EV03: outbox `domain_outbox` + worker que envía template por API WHAAPY con dueño único. | EV03, B7, F19 |
| N025 | Webhook Cancelación Doctor | webhook | principal | main[0]→POST - Mensaje Cancelación Doctor | path /findmed-cancelacionDoctor | reemplazar | EV02: outbox `domain_outbox` + worker que envía template por API WHAAPY con dueño único. | EV02, B7, F19 |
| N026 | Webhook Autocancelación | webhook | principal | main[0]→POST - Mensaje Autocancelación | path /findmed-Autocancelacion | reemplazar | EV04: outbox `domain_outbox` + worker que envía template por API WHAAPY con dueño único. | EV04, B7, F19 |
| N027 | Webhook Recordatorio 8:00am | webhook | principal | main[0]→POST - Mensaje Recordatorio 8am | path /findmed-Recordatorio8am | reemplazar | EV05: outbox `domain_outbox` + worker que envía template por API WHAAPY con dueño único. | EV05, B7, F19 |
| N028 | Sticky Note7 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N029 | Sticky Note9 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N030 | Sticky Note10 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N031 | Sticky Note11 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N032 | Sticky Note12 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N033 | Búsqueda Tabla Doctores | httpRequest | principal | main[0]→Switch1 | host https://iepdgygvztocornqkkhk.supabase.co | reemplazar | MCP `search_care_options` (none/one/many, office_id, alias de ciudad) contra el proyecto vigente. | M01, F01, F02, F04 |
| N034 | Switch1 | switch | principal | main[0]→Add Tag agendamiento; main[1]→POST - Match Parcial; main[2]→POST - Mensaje No Match | — | reemplazar | Decisión none/one/many dentro de `search_care_options` + selección explícita del paciente. | F01, R03 |
| N035 | Sticky Note25 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N036 | Set Campos bot | set | principal | main[0]→Switch | — | consolidar | Adaptación de contexto; la identidad viene de `{{contact.phoneNumber}}` mapeado, no de texto libre. | N21, B5 |
| N037 | Sticky Note26 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N038 | Set Link Agendamiento | set | principal | main[0]→Triage_Webhook | — | reemplazar | Propagar la opción elegida (doctor_id+office_id); no `doctors[0]`. | F03, R04 |
| N039 | Sticky Note28 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N040 | Set Webhook Info 2 | set | principal | main[0]→FINDI | — | consolidar | Adaptación de contexto; la identidad viene de `{{contact.phoneNumber}}` mapeado, no de texto libre. | N21, B5 |
| N041 | POST - Mensaje Cita Reservada | whaapy | principal | main[0]→Get a contact | template reservada_estado_cita | reemplazar | Template `reservada_estado_cita` enviado por el worker con dueño único (EV01). | EV01, B7 |
| N042 | POST - Mensaje Cita Confirmada | whaapy | principal | main[0]→POST - Boton Cancelar cita | template confirmada_estado_cita | reemplazar | Template `confirmada_estado_cita` enviado por el worker con dueño único (EV01). | EV01, B7 |
| N043 | POST - Mensaje Cita Cancelada Paciente | whaapy | principal | — | template cancelada_paciente | reemplazar | Template `cancelada_paciente` enviado por el worker con dueño único (EV01). | EV01, B7 |
| N044 | POST - Mensaje Cita Completada | whaapy | principal | main[0]→Get a contact2 | template cita_completada | reemplazar | Template `cita_completada` enviado por el worker con dueño único (EV01). | EV01, B7 |
| N045 | POST - Mensaje Confirmación 48hr | whaapy | principal | main[0]→POST - Boton Cancelar cita1 | template dosdias_pre_confirmacion | reemplazar | Template `dosdias_pre_confirmacion` enviado por el worker con dueño único (EV03). | EV03, B7 |
| N046 | POST - Mensaje Cancelación Doctor | whaapy | principal | — | template canceladadoc_estado_cita | reemplazar | Template `canceladadoc_estado_cita` enviado por el worker con dueño único (EV02). | EV02, B7 |
| N047 | POST - Mensaje Autocancelación | whaapy | principal | — | template autocancelada_estado_cita | reemplazar | Template `autocancelada_estado_cita` enviado por el worker con dueño único (EV04). | EV04, B7 |
| N048 | POST - Mensaje Recordatorio 8am | whaapy | principal | main[0]→POST - Boton Cancelar cita2 | template cita_manana_recordatorio | reemplazar | Template `cita_manana_recordatorio` enviado por el worker con dueño único (EV05). | EV05, B7 |
| N049 | Sticky Note14 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N050 | Webhook Info Formulario Doc | webhook | principal | — | path /findmed-Formulario_doc | pendiente | EV06: el export no tiene consumidor (main vacío). Definir recorrido antes de migrar. | EV06, F18 |
| N051 | Sticky Note15 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N052 | Webhook Envío Informe | webhook | principal | — | path /findmed-Envio_informe | pendiente | EV07: el export no tiene consumidor (main vacío). Definir recorrido antes de migrar. | EV07, F18 |
| N053 | Get - Contacto | whaapy | principal | main[0]→Revisar Tags | — | consolidar | Lectura de contacto: contexto fijo de WHAAPY / API por teléfono en el worker. | N21, B7 |
| N054 | Add Tag triaje | httpRequest | principal | main[0]→Funnel Triaje | host https://api.whaapy.com | consolidar | Acción nativa WHAAPY de etiqueta/embudo, proyectada desde estado de dominio con un solo dueño. | §7.3 |
| N055 | Add Tag match_doctor | httpRequest | principal | main[0]→Funnel Match Doctor | host https://api.whaapy.com | consolidar | Acción nativa WHAAPY de etiqueta/embudo, proyectada desde estado de dominio con un solo dueño. | §7.3 |
| N056 | Add Tag agendamiento | httpRequest | principal | main[0]→Funnel Agendamiento | host https://api.whaapy.com | consolidar | Acción nativa WHAAPY de etiqueta/embudo, proyectada desde estado de dominio con un solo dueño. | §7.3 |
| N057 | Trigger | whaapyTrigger | principal | main[0]→Get - Contacto | — | reemplazar | El agente nativo pasa a ser el único dueño de la conversación al corte. | B10, R38 |
| N058 | Add Tag ambulancia_evento | httpRequest | principal | main[0]→POST - Evento | host https://api.whaapy.com | pendiente | Solicitud de ambulancia: abrir caso con responsable. Alcance del servicio de ambulancias por confirmar con FindMed. | M09, §12 |
| N059 | Add Tag ambulancia_emergencia | httpRequest | principal | main[0]→POST - Emergencia recibida | host https://api.whaapy.com | pendiente | Solicitud de ambulancia: abrir caso con responsable. Alcance del servicio de ambulancias por confirmar con FindMed. | M09, §12 |
| N060 | Switch Valor Botón | switch | principal | main[0]→POST - Mensaje Ambulancias; main[1]→Add Tag triaje; main[2]→Quitar Tags2; main[4]→Add Tag ambulancia_emergencia; main[5]→Add Tag ambulancia_evento; main[6]→Add Tag ambulancia_traslado; main[7]→Add Tag ambulancia_info_general; main[8]→Cancelar Cita; main[9]→Confirmar Cita | — | consolidar | Payloads de botón (confirmar/cancelar/menú) manejados por `whaapy-inbound` y automatizaciones WHAAPY. | N24, B7 |
| N061 | Switch2 | switch | principal | main[0]→TextOrId1; main[1]→TextOrId1; main[2]→TextOrId1; main[3]→TextOrId1; main[6]→TextOrId; main[7]→TextOrId | — | consolidar | Ruteo absorbido por agente nativo / estados de dominio. | B8 |
| N062 | TextOrId | set | principal | main[0]→Switch Valor Botón | — | consolidar | Adaptación de contexto; la identidad viene de `{{contact.phoneNumber}}` mapeado, no de texto libre. | N21, B5 |
| N063 | Quitar Tags2 | httpRequest | principal | main[0]→POST - Mensaje Inicial1 | host https://api.whaapy.com | consolidar | Acción nativa WHAAPY de etiqueta/embudo, proyectada desde estado de dominio con un solo dueño. | §7.3 |
| N064 | Revisar Tags | switch | principal | main[0]→POST - Mensaje Inicial; main[1]→Switch2 | — | consolidar | Ruteo absorbido por agente nativo / estados de dominio. | B8 |
| N065 | Add Tag apoyo_asesor | httpRequest | principal | — | host https://api.whaapy.com | reemplazar | MCP `open_case` + `request_handoff` (caso, asignación y pausa verificables); etiqueta solo como proyección. | M09, M10, F05 |
| N066 | Add Tag urgencia | httpRequest | principal | main[0]→POST - Message1 | host https://api.whaapy.com | reemplazar | MCP `open_case` + `request_handoff` (caso, asignación y pausa verificables); etiqueta solo como proyección. | M09, M10, F05 |
| N067 | Add Tag apoyo_asesor1 | httpRequest | principal | — | host https://api.whaapy.com | reemplazar | MCP `open_case` + `request_handoff` (caso, asignación y pausa verificables); etiqueta solo como proyección. | M09, M10, F05 |
| N068 | Cancelar Cita | httpRequest | principal | — | host https://iepdgygvztocornqkkhk.supabase.co | reemplazar | Botón con payload {acción, appointment_id} → `whaapy-inbound` / MCP prepare+commit; nunca 'primera cita del teléfono'. | M05, M06, M07, F02, F14, N24 |
| N069 | Confirmar Cita | httpRequest | principal | — | host https://iepdgygvztocornqkkhk.supabase.co | reemplazar | Botón con payload {acción, appointment_id} → `whaapy-inbound` / MCP prepare+commit; nunca 'primera cita del teléfono'. | M05, M06, M07, F02, F14, N24 |
| N070 | Add Tag bienvenida_enviada | httpRequest | principal | — | host https://api.whaapy.com | consolidar | Acción nativa WHAAPY de etiqueta/embudo, proyectada desde estado de dominio con un solo dueño. | §7.3 |
| N071 | Sticky Note2 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N072 | Funnel Triaje | whaapy | principal | main[0]→Switch Tag Paciente | — | reemplazar | Etapa de embudo proyectada desde estado persistido (cita/caso), no optimista. | F08, §7.3 |
| N073 | TextOrId1 | set | principal | main[0]→Switch Tag Paciente | — | consolidar | Adaptación de contexto; la identidad viene de `{{contact.phoneNumber}}` mapeado, no de texto libre. | N21, B5 |
| N074 | Funnel Match Doctor | whaapy | principal | main[0]→Búsqueda Tabla Doctores | — | reemplazar | Etapa de embudo proyectada desde estado persistido (cita/caso), no optimista. | F08, §7.3 |
| N075 | Set Webhook Info3 | set | principal | main[0]→Funnel Match Doctor | — | consolidar | Adaptación de contexto; la identidad viene de `{{contact.phoneNumber}}` mapeado, no de texto libre. | N21, B5 |
| N076 | Funnel Agendamiento | whaapy | principal | main[0]→Set Link Agendamiento | — | reemplazar | Etapa de embudo proyectada desde estado persistido (cita/caso), no optimista. | F08, §7.3 |
| N077 | POST - Message | whaapy | principal | — | — | retirar | Envío de texto del agente n8n; el agente nativo responde directamente. | B8 |
| N078 | POST - Match Doctor | whaapy | principal | main[0]→Wait1 | — | reemplazar | Respuesta del agente según resultado none/one/many de `search_care_options`. | F01, M01, M04 |
| N079 | POST - Mensaje Inicial | whaapy | principal | main[0]→Add Tag bienvenida_enviada | — | pendiente | Menú de bienvenida (Ambulancia / Cita Médica): decidir si lo da el agente o una automatización con 'Omitir IA'. | B8 |
| N080 | POST - Mensaje Inicial1 | whaapy | principal | — | — | pendiente | Menú de bienvenida (Ambulancia / Cita Médica): decidir si lo da el agente o una automatización con 'Omitir IA'. | B8 |
| N081 | POST - Mensaje Ambulancias | whaapy | principal | — | — | pendiente | Mensaje estático del servicio de ambulancias: conservar como automatización/knowledge WHAAPY si FindMed lo confirma. | §12, R08 |
| N082 | POST - Volver al Inicio | whaapy | principal | — | — | pendiente | Menú de bienvenida (Ambulancia / Cita Médica): decidir si lo da el agente o una automatización con 'Omitir IA'. | B8 |
| N083 | POST - Emergencia recibida | whaapy | principal | main[0]→Wait | — | pendiente | Mensaje estático del servicio de ambulancias: conservar como automatización/knowledge WHAAPY si FindMed lo confirma. | §12, R08 |
| N084 | POST - Evento | whaapy | principal | main[0]→Wait | — | pendiente | Mensaje estático del servicio de ambulancias: conservar como automatización/knowledge WHAAPY si FindMed lo confirma. | §12, R08 |
| N085 | Wait | wait | principal | main[0]→POST - Volver al Inicio | — | retirar | Espera artificial; seguimiento durable solo con regla aprobada. | B7 |
| N086 | POST - Volver al Inicio1 | whaapy | principal | main[0]→Add Tag reservada | — | pendiente | Menú de bienvenida (Ambulancia / Cita Médica): decidir si lo da el agente o una automatización con 'Omitir IA'. | B8 |
| N087 | Wait1 | wait | principal | main[0]→POST - Volver al Inicio1 | — | retirar | Espera artificial; seguimiento durable solo con regla aprobada. | B7 |
| N088 | POST - Mensaje No Match | whaapy | principal | main[0]→Add Tag apoyo_asesor1 | — | reemplazar | Respuesta del agente según resultado none/one/many de `search_care_options`. | F01, M01, M04 |
| N089 | POST - Message1 | whaapy | principal | — | — | retirar | Envío de texto del agente n8n; el agente nativo responde directamente. | B8 |
| N090 | POST - Match Parcial | whaapy | principal | main[0]→POST - Volver al Inicio2 | — | reemplazar | Respuesta del agente según resultado none/one/many de `search_care_options`. | F01, M01, M04 |
| N091 | POST - Volver al Inicio2 | whaapy | principal | main[0]→Add Tag apoyo_asesor2 | — | pendiente | Menú de bienvenida (Ambulancia / Cita Médica): decidir si lo da el agente o una automatización con 'Omitir IA'. | B8 |
| N092 | Get a contact | whaapy | principal | main[0]→Funnel Cita Agendada | — | consolidar | Lectura de contacto: contexto fijo de WHAAPY / API por teléfono en el worker. | N21, B7 |
| N093 | Funnel Cita Agendada | whaapy | principal | main[0]→Pide Documentos | — | reemplazar | Etapa de embudo proyectada desde estado persistido (cita/caso), no optimista. | F08, §7.3 |
| N094 | Get a contact1 | whaapy | principal | main[0]→Funnel Cita Confirmada | — | consolidar | Lectura de contacto: contexto fijo de WHAAPY / API por teléfono en el worker. | N21, B7 |
| N095 | Funnel Cita Confirmada | whaapy | principal | — | — | reemplazar | Etapa de embudo proyectada desde estado persistido (cita/caso), no optimista. | F08, §7.3 |
| N096 | Get a contact2 | whaapy | principal | main[0]→Funnel Cita Completada | — | consolidar | Lectura de contacto: contexto fijo de WHAAPY / API por teléfono en el worker. | N21, B7 |
| N097 | Funnel Cita Completada | whaapy | principal | — | — | reemplazar | Etapa de embudo proyectada desde estado persistido (cita/caso), no optimista. | F08, §7.3 |
| N098 | POST - Boton Cancelar cita | whaapy | principal | main[0]→Get a contact1 | template boton_cancelar_cita | reemplazar | Template `boton_cancelar_cita`: botón con payload ligado a appointment_id (allowButtonIdOverride). | N24, F14, B7 |
| N099 | POST - Boton Cancelar cita1 | whaapy | principal | main[0]→POST - Boton Confirmar Cita | template boton_cancelar_cita | reemplazar | Template `boton_cancelar_cita`: botón con payload ligado a appointment_id (allowButtonIdOverride). | N24, F14, B7 |
| N100 | POST - Boton Confirmar Cita | whaapy | principal | — | template boton_confirmar_cita | reemplazar | Template `boton_confirmar_cita`: botón con payload ligado a appointment_id (allowButtonIdOverride). | N24, F14, B7 |
| N101 | POST - Boton Cancelar cita2 | whaapy | principal | — | template boton_cancelar_cita | reemplazar | Template `boton_cancelar_cita`: botón con payload ligado a appointment_id (allowButtonIdOverride). | N24, F14, B7 |
| N102 | Add Tag ambulancia_traslado | httpRequest | principal | main[0]→POST - Traslado | host https://api.whaapy.com | pendiente | Solicitud de ambulancia: abrir caso con responsable. Alcance del servicio de ambulancias por confirmar con FindMed. | M09, §12 |
| N103 | Add Tag ambulancia_info_general | httpRequest | principal | main[0]→POST - Info General | host https://api.whaapy.com | pendiente | Solicitud de ambulancia: abrir caso con responsable. Alcance del servicio de ambulancias por confirmar con FindMed. | M09, §12 |
| N104 | POST - Info General | whaapy | principal | main[0]→Wait | — | pendiente | Mensaje estático del servicio de ambulancias: conservar como automatización/knowledge WHAAPY si FindMed lo confirma. | §12, R08 |
| N105 | POST - Traslado | whaapy | principal | main[0]→Wait | — | pendiente | Mensaje estático del servicio de ambulancias: conservar como automatización/knowledge WHAAPY si FindMed lo confirma. | §12, R08 |
| N106 | If hay mensaje | if | principal | main[0]→Set Campos bot; main[1]→POST - Message2 | — | retirar | Parser de <<<METADATA>>> y bifurcación invertida; los resultados de tools son estructurados. | F06, R12 |
| N107 | POST - Message2 | whaapy | principal | main[0]→Set Campos bot | — | retirar | Envío de texto del agente n8n; el agente nativo responde directamente. | B8 |
| N108 | Add Tag apoyo_asesor2 | httpRequest | principal | — | host https://api.whaapy.com | reemplazar | MCP `open_case` + `request_handoff` (caso, asignación y pausa verificables); etiqueta solo como proyección. | M09, M10, F05 |
| N109 | Sticky Note16 | stickyNote | nota | — | — | retirar | Nota visual del lienzo; se conserva solo como referencia en este inventario. | — |
| N110 | Webhook Reagendado | webhook | principal | main[0]→POST - Mensaje Reagendamiento Staff | path /findmed-reagendado | reemplazar | EV08: outbox `domain_outbox` + worker que envía template por API WHAAPY con dueño único. | EV08, B7, F19 |
| N111 | POST - Mensaje Reagendamiento Staff | whaapy | principal | — | template cita_reagendada_staff | reemplazar | Template `cita_reagendada_staff` enviado por el worker con dueño único (EV08). | EV08, B7 |
| N112 | SQL Query1 | postgresTool | desconectado | ai_tool→FINDI Pre Mejoras Julio 21 | — | retirar | Respaldo desconectado del recorrido principal; histórico, no se reproduce. | §7.4 |
| N113 | Gemini 2.5 flash1 | lmChatOpenRouter | desconectado | ai_languageModel→FINDI Pre Mejoras Julio 21 | — | retirar | Respaldo desconectado del recorrido principal; histórico, no se reproduce. | §7.4 |
| N114 | Postgres Chat Memory1 | memoryPostgresChat | desconectado | ai_memory→FINDI Pre Mejoras Julio 21 | — | retirar | Respaldo desconectado del recorrido principal; histórico, no se reproduce. | §7.4 |
| N115 | FINDI Pre Mejoras Julio 21 | agent | desconectado | — | — | retirar | Respaldo desconectado del recorrido principal; histórico, no se reproduce. | §7.4 |
| N116 | Pide Documentos | whaapy | principal | — | template pedir_documentos | pendiente | Template `pedir_documentos`: definir qué documentos, dónde se guardan y quién accede. | §7.2 |
| N117 | Add Tag reservada | httpRequest | principal | — | host https://api.whaapy.com | reemplazar | Etapa/etiqueta derivada de cita persistida (evento appointment.created), no del enlace enviado. | F08, R13 |
