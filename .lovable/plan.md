

## Plan: Agregar opción de eliminar en catálogos

### Contexto
Actualmente las 5 secciones de catálogos (ciudades, zonas, especialidades, hospitales, laboratorios) solo tienen editar y activar/desactivar. Falta un botón de eliminar con confirmación.

Las políticas RLS ya permiten DELETE para admins (política "Admin can manage" con comando ALL), así que no se necesita migración.

### Cambios en `src/pages/admin/Catalogos.tsx`

1. **Importar** `Trash2` de lucide-react y los componentes `AlertDialog*`

2. **Componente compartido `DeleteConfirmDialog`**: Un AlertDialog reutilizable que recibe `open`, `onClose`, `onConfirm`, `itemName` y `deleting`. Muestra "¿Eliminar {itemName}? Esta acción no se puede deshacer."

3. **`CatalogTable` (usado por Cities)**: Agregar prop `onDelete`. Añadir botón Trash2 en la columna de acciones junto al botón de editar y el switch.

4. **`CitiesTab`**: Agregar `deleteMut` que hace `supabase.from("cities").delete().eq("id", id)`. Estado para `deleteItem`. Pasar `onDelete` a `CatalogTable`. Renderizar `DeleteConfirmDialog`.

5. **`ZonesTab`**: Mismo patrón — `deleteMut` con `supabase.from("zones").delete()`, botón Trash2 en la tabla inline, y `DeleteConfirmDialog`.

6. **`SpecialtiesTab`**: Mismo patrón para `specialties`.

7. **`FacilitiesTab` (Hospitals/Labs)**: Mismo patrón — `deleteMut` genérico usando el prop `type`, botón Trash2, y `DeleteConfirmDialog`.

### Diseño UI
- Botón: icono Trash2 con `variant="ghost"` y clase `text-destructive` al lado de Pencil
- Diálogo: AlertDialog con título "Eliminar registro", descripción con el nombre, botones "Cancelar" y "Eliminar" (destructive)

### No se necesita
- Migración de base de datos (RLS ya cubre DELETE)
- Cambios en edge functions
- Cambios en otros archivos

