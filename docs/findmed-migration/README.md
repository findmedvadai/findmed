# Migración FindMed: n8n → agente nativo WHAAPY + MCP propio

Estado persistente del proyecto de estabilización y migración. Sin secretos ni datos de pacientes.

| Archivo | Para qué |
|---|---|
| [estado-ejecucion.md](estado-ejecucion.md) | **Empezar aquí al retomar**: bloque en curso, siguiente acción, bloqueos. |
| [estado-actual.md](estado-actual.md) | Ambientes, mapa del sistema, qué está desplegado y dónde. |
| [hallazgos.md](hallazgos.md) | F01–F22 conciliados y hallazgos nuevos N01–N24, con evidencia y estado. |
| [decisiones.md](decisiones.md) | Decisiones de negocio (D1–D4) y técnicas (A1–A9) con alternativas. |
| [cobertura.md](cobertura.md) | Secciones del plan, bloques, M01–M11, EV01–EV08 y garantías X01–X12. |
| [n8n-nodos.md](n8n-nodos.md) | Los 117 nodos del export con su destino. Generado por `scripts/n8n-inventory.mjs`. |
| [pruebas.md](pruebas.md) | Línea base, pruebas ejecutadas y suite R01–R40. |

Fuentes no versionadas (guardar fuera del repo): `FINDMED-Plan-Claude-Code.txt` v2 y `FINDMED-N8N-Referencia-Sin-Secretos.json`.

Regenerar el inventario de nodos:

```
node scripts/n8n-inventory.mjs <ruta-al-export.json>
```

Reglas: trabajo en rama, commits atómicos, nada a producción sin indicación explícita de Alex, y ningún requisito se
cierra como **validado** sin evidencia identificable (ver `pruebas.md`).
