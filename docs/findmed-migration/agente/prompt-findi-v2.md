# Prompt del agente FINDI — v2.5 (WHAAPY nativo + MCP de FindMed)

> Versión 2.1 · 12-oct-2026 · Bloque B8. Estructura tomada del prompt de MENNA (Daniela v11), que funciona
> con herramientas, más lo que sí servía de FINDI v1 (n8n): ruta de seguridad, recolección de síntomas y tono.
> El texto para pegar en WHAAPY está en **`FINDI-prompt.txt`** (archivo completo, sin editar). Este archivo solo explica la versión.
> Pendientes de FindMed: aprobar los textos de urgencia (D7) y validar el catálogo de triaje v2 (D12). Cambios y motivos al final del archivo.

El prompt vive en `FINDI-prompt.txt`. Cualquier cambio se hace ahí y se sube la versión.


## Cambios respecto a v2.0 y a FINDI v1 (n8n) — no pegar en WHAAPY

v2.5 (14-oct-2026): ver las últimas filas de la tabla (necesidad primero, nunca "no tenemos médicos en tu zona",
seguro con aseguradora y póliza, hospitales de la red en urgencias del día, documentos recibidos).

| Antes | v2.1 | Motivo |
|---|---|---|
| Prompt libre por pasos (v1 y v2.0) | Estructura MENNA: prioridad explícita, variables, gates, mapa de triggers, referencia de herramientas, errores por código, prohibiciones | Es la estructura que ya funciona con herramientas en MENNA |
| Sin fecha | Variables `{{system.*}}` de fecha, hora y día | list_available_slots necesita fechas YYYY-MM-DD correctas |
| Solo CDMX y Querétaro | Ciudades del catálogo vía search_care_options | D6 |
| SQL libre contra `triage_findmed` (en el Postgres de VADAI) | `suggest_specialty`: mismo ranking (coincidencias + semáforo), parámetros cerrados al catálogo de keywords, empates y ampliación automática; catálogo importado a FindMed | F10, M02 (v2.2) |
| Bloques `<<<METADATA>>>` + TAG | open_case + request_handoff | M09/M10, R31/R32 |
| Menú de ambulancias | Retirado | D5 |
| "Confirmar/cancelar la primera cita del teléfono" | Cita explícita + enlace seguro; botones con id los procesa FindMed | F14, A4/A6 |
| "Te transfiero con un asesor" sin respaldo | Texto según assignment real; nunca "asesor asignado" sin confirmación | R32 |
| Textos de urgencia | Se conservan de la v1 con handoff real | D7 — **confirmar con FindMed** |
| v2.2: si negaba las alarmas → semáforo NARANJA y agendar | v2.3: la `routing` del catálogo manda (urgencias_inmediato → seguridad; urgencias_hoy → urgencias + persona, sin agendar; consulta_mismo_dia → horarios más cercanos) | N32 |
| v2.3: "imagen que no entiendes → no me llegó bien" chocaba con los documentos que FindMed pide al reservar (`pedir_documentos`) | v2.4: toda imagen/PDF después de pedir documentos es documento ("Recibido"), FAQ de qué documentos, foto de síntoma sin opinar, y el mensaje del enlace avisa que se pedirán póliza e INE | Flujo de documentos (D11) |
| Duración fuera de las keywords | `subito` / `cronico` como keywords; empates con `pregunta_diferencial` | Catálogo v2 (D12) |
| v2.4: saludo igual para todos y seguro antes de saber qué necesita; "quiero una cita" y "busco ortopedista" recibían casi la misma respuesta | v2.5: PASO 1 = qué necesita (si no lo dijo, "¿Qué especialista buscas o qué te está pasando?"); el saludo reconoce lo que pidió; search_care_options solo con necesidad + ciudad (gate y FALLO 7) | Queja del cliente (14-oct): respuestas iguales sin identificar la necesidad |
| v2.4: con `no_active_offices` el agente terminaba en "no encontré agenda" y a veces "no tenemos especialistas en tu zona" | v2.5: nunca cerrar la puerta (FALLO 8 y prohibición explícita). `search_care_options` ahora devuelve `alternatives` (otras zonas de la ciudad con opciones, u otras ciudades) y `escalate=true` cuando no hay nada → caso `appointment_help` + `request_handoff` sin esperar a que lo pida | Queja del cliente (14-oct): "nunca debería cerrar las posibilidades de atención" |
| v2.4: solo "¿tienes seguro?" (sí/no); no se pedía aseguradora ni póliza | v2.5: si tiene seguro, aseguradora y número de póliza en una sola pregunta (sin bloquear si no tiene la póliza) → `save_patient_insurance`; también viajan en `create_booking_link`. Se ven en el detalle de la cita del admin y del doctor | Decisión FindMed (a) |
| v2.4: `urgencias_hoy` → "ve a urgencias" + persona, sin decir a dónde | v2.5: `find_network_hospitals` con la ciudad del paciente, 1–3 hospitales de la red con dirección y teléfono (solo si el catálogo lo tiene), caso `urgency` con prioridad `urgent` + `request_handoff`. `urgencias_inmediato`: primero 911 / urgencia más cercana, sin buscar hospitales | Decisión FindMed (c) |
| v2.4: "Recibido, gracias" | v2.5: al recibir foto/PDF tras la solicitud, agradece y confirma que sus documentos ya quedaron con el equipo. FindMed marca la cita "Documentos recibidos" y avisa al admin (sin guardar archivos) | Decisión FindMed (b) |
| — | v2.5: herramientas nuevas en la referencia, mapa de triggers y errores: `save_patient_insurance`, `find_network_hospitals`, `find_network_laboratories` (re-sincronizar herramientas en WHAAPY: 13) | — |
