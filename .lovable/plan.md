

## Plan: Simplificar modal "Enviar Informe"

Eliminar el campo de búsqueda separado y el campo "Seleccionar destino" redundante. Dejar solo:

1. **Tipo de destino** (Hospital / Laboratorio) — sin cambios
2. **Un único dropdown** que muestre directamente los hospitales o laboratorios activos del catálogo (nombre + ciudad/zona). Sin campo de texto de búsqueda aparte.

### Cambios en `src/components/admin/SendReportModal.tsx`

- Eliminar el estado `search` y el campo `<Input>` de búsqueda (líneas 36, 65-70, 174-182)
- Eliminar el label "Seleccionar destino" redundante
- Cambiar el label del dropdown a "Seleccionar hospital" o "Seleccionar laboratorio" según el tipo
- Usar `options` directamente en vez de `filtered`
- Ambas queries se habilitan cuando `open` es true (quitar condición de `destType`) para precargar ambas listas

