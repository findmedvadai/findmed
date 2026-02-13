

## Eliminar doctores (borrado logico)

Ya existe el campo `is_active` en la tabla `doctors`, pero actualmente se usa como un simple toggle activo/inactivo. La idea es agregar un concepto de "eliminado" que sea mas permanente y oculte al doctor de todas las vistas operativas, conservando los datos para consultas historicas.

### Enfoque: Nuevo campo `is_deleted` en la tabla `doctors`

Se agrega una columna `is_deleted` (boolean, default false) para separar el concepto de "inactivo temporal" (que ya existe con `is_active`) del de "eliminado permanente". Un doctor eliminado no aparece en ninguna vista excepto en citas pasadas.

### Cambios en base de datos

Migracion SQL:
```sql
ALTER TABLE public.doctors ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
```

### Cambios en la interfaz (`Doctores.tsx`)

1. **Boton "Eliminar"** en el dialog de detalle del doctor, con un `AlertDialog` de confirmacion ("Este doctor dejara de aparecer en la plataforma. Las citas pasadas se conservaran. Esta accion no se puede deshacer facilmente.")
2. **Mutacion**: `supabase.from("doctors").update({ is_deleted: true, is_active: false }).eq("id", doctorId)`
3. **Query principal**: Agregar `.eq("is_deleted", false)` al query de doctores para excluirlos de la lista

### Ocultar doctores eliminados en las demas vistas

Los siguientes queries ya filtran por `is_active = true`, pero para mayor seguridad se agrega tambien `.eq("is_deleted", false)`:

- **Calendario.tsx**: query de `all-doctors-for-filter` (linea 189)
- **Reservas.tsx**: los doctores en los filtros (si los hay)
- **DoctorProfileCard.tsx**: no aplica, es del portal del doctor

Las citas pasadas (`appointments`) seguiran mostrando el nombre del doctor mediante el join `doctors(full_name)` sin importar si esta eliminado, porque la relacion es por `doctor_id` y no se filtra por estado del doctor en esos queries.

### Resumen de archivos a modificar

| Archivo | Cambio |
|---|---|
| `doctors` (DB) | Agregar columna `is_deleted` boolean default false |
| `src/pages/admin/Doctores.tsx` | Boton eliminar con confirmacion, filtrar `is_deleted = false` en query |
| `src/pages/admin/Calendario.tsx` | Agregar `.eq("is_deleted", false)` al query de doctores para filtros |

### Detalles tecnicos

- Se usa `AlertDialog` (ya importado en el proyecto) para la confirmacion de eliminacion
- El boton de eliminar aparece en rojo en el footer del dialog de detalle, junto a "Desactivar" y "Editar"
- No se necesita edge function: el admin ya tiene permisos RLS para hacer UPDATE en `doctors`
- No se borra fisicamente el registro ni el auth user, solo se marca como eliminado

