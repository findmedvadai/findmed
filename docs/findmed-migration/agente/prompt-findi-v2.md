# Prompt del agente FINDI — v2.3 (WHAAPY nativo + MCP de FindMed)

> Versión 2.1 · 12-oct-2026 · Bloque B8. Estructura tomada del prompt de MENNA (Daniela v11), que funciona
> con herramientas, más lo que sí servía de FINDI v1 (n8n): ruta de seguridad, recolección de síntomas y tono.
> El texto para pegar en WHAAPY está en **`FINDI-prompt.txt`** (archivo completo, sin editar). Este archivo solo explica la versión.
> Pendientes de FindMed: aprobar los textos de urgencia (D7) y validar el catálogo de triaje v2 (D12). Cambios y motivos al final del archivo.

El prompt vive en `FINDI-prompt.txt`. Cualquier cambio se hace ahí y se sube la versión.


## Cambios respecto a v2.0 y a FINDI v1 (n8n) — no pegar en WHAAPY

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
| Duración fuera de las keywords | `subito` / `cronico` como keywords; empates con `pregunta_diferencial` | Catálogo v2 (D12) |
