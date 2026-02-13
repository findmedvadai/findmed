

## Plan de mejoras: Colores de especialidad, credenciales de doctor, layout de filtros y filtros del calendario

### 1. Migracion de base de datos: agregar columna `color` a `specialties`

Se agrega una columna `color` (tipo text, nullable, default null) a la tabla `specialties` para que el admin pueda elegir y guardar el color de cada especialidad de forma permanente.

```sql
ALTER TABLE public.specialties ADD COLUMN color text DEFAULT NULL;
```

### 2. Refactorizar `specialty-colors.ts`

Cambiar la funcion `getSpecialtyColor` para que reciba el color directamente de la base de datos en vez de calcularlo por posicion. La funcion ahora recibira un mapa de specialty_id -> color (proveniente de la DB). Si la especialidad no tiene color asignado, se usa un gris por defecto.

```typescript
// Nueva firma simplificada
export function getSpecialtyColor(specialtyId: string, colorMap: Record<string, string>): string {
  return colorMap[specialtyId] ?? "#6B7280";
}
```

Se exporta tambien la paleta `SPECIALTY_COLORS` para mostrarla como opciones en el catalogo.

### 3. Catalogos: selector de color en Especialidades

En la tab de Especialidades de `Catalogos.tsx`:
- Agregar un campo "Color" al formulario de crear/editar especialidad
- Mostrar la paleta de 8 colores predefinidos como circulos clickeables, mas un input libre para color hex personalizado
- La columna de color se muestra en la tabla como un circulo con el color asignado junto al nombre
- Guardar el color en la columna `specialties.color`

### 4. Actualizar todos los consumidores de `getSpecialtyColor`

Archivos afectados:
- **`Calendario.tsx`**: En vez de construir `sortedSpecialtyIds`, cargar el color directamente de la especialidad. El query ya trae `specialties(id, name)` - se agrega `color` al select. Se construye un `colorMap` (id -> color) y se pasa a `getSpecialtyColor`.
- **`Doctores.tsx`**: Mismo cambio, cargar colores desde la query de specialties del catalogo y pasar el `colorMap`.
- **`Reservas.tsx`** (si usa colores): Mismo patron.

### 5. Doctor detail dialog: mostrar credenciales de login

En el popup de detalle del doctor en `Doctores.tsx`:
- Agregar una seccion "Acceso a la plataforma" que muestre:
  - **Email**: Se obtiene haciendo join con la tabla `users` para obtener el `user_id` (auth user id), y luego se consulta `auth.users` a traves de una edge function o se almacena el email en la tabla `doctors` o `users`.
  
**Solucion propuesta**: Como no se puede consultar `auth.users` directamente desde el cliente, se modifica la edge function `create-doctor` para guardar el email en la tabla `users` (nueva columna `email`). Tambien se agrega la contrasena temporal en texto para que el admin la vea (nueva columna `initial_password` en `users`).

Migracion adicional:
```sql
ALTER TABLE public.users ADD COLUMN email text DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN initial_password text DEFAULT NULL;
```

En el detail dialog:
- Se hace un query adicional: `supabase.from("users").select("email, initial_password").eq("doctor_id", doctor.id).single()`
- Se muestra el email y la contrasena con un boton de copiar
- Nota: la contrasena inicial solo se muestra si existe; si el doctor la cambio, solo quedara la original como referencia

La edge function `create-doctor` se actualiza para guardar `email` e `initial_password` en la tabla `users`.

### 6. Layout de filtros en Doctores y Reservas

En ambas paginas:
- La barra de busqueda ocupa el **ancho completo** (100% de la fila)
- Los filtros (especialidad, ciudad, zona, estado, doctor) van en una **segunda fila** debajo de la busqueda
- Se mantiene el mismo orden y funcionalidad

Cambio en Doctores.tsx y Reservas.tsx:
```text
Fila 1: [========= Busqueda (full width) =========]
Fila 2: [Especialidad] [Ciudad] [Zona] [Estado] [Limpiar]
```

### 7. Filtros del Calendario con busqueda (Combobox)

En `Calendario.tsx`, los filtros de Doctor y Especialidad actualmente son `Select` simples que solo muestran las opciones de los appointments de esa semana. Se cambian a:
- Usar **todas** las especialidades y doctores del sistema (no solo los de la semana actual), consultando las tablas `specialties` y `doctors` directamente
- Reemplazar los `Select` por un componente tipo **Combobox** (usando `Command` de cmdk + `Popover`) que permita escribir para filtrar opciones
- Se muestra un input de texto con un dropdown filtrable

### Resumen de archivos a modificar

| Archivo | Cambio |
|---|---|
| `specialties` (DB) | Agregar columna `color` |
| `users` (DB) | Agregar columnas `email` e `initial_password` |
| `src/lib/specialty-colors.ts` | Simplificar para usar color de DB |
| `src/pages/admin/Catalogos.tsx` | Agregar selector de color en Especialidades |
| `src/pages/admin/Doctores.tsx` | Mostrar credenciales, layout filtros, usar colorMap |
| `src/pages/admin/Reservas.tsx` | Layout filtros (busqueda full width, filtros abajo) |
| `src/pages/admin/Calendario.tsx` | Combobox con busqueda, cargar todos los doctores/especialidades, usar colorMap |
| `supabase/functions/create-doctor/index.ts` | Guardar email e initial_password en users |

