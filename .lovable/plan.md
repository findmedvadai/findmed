## Implementacion de Doctores (tarjetas), Catalogos e Inbox del Admin

### 1. Pagina de Doctores (`src/pages/admin/Doctores.tsx`) - Tarjetas con colores de especialidad + CRUD

**Vista principal: Grid de tarjetas**

Cada doctor se muestra como una tarjeta con el mismo estilo visual del calendario admin:

```text
+--------------------------------------+
|  [border-left-4 color especialidad]  |
|           Dr. Juan Garcia            |
|                                      |
|             Ginecologia              |
|                                      |
|    Ciudad de Mexico - Zona Norte     |
|                                      |
+--------------------------------------+
```

- Rectangulo blanco redondeado con `border-l-4` del color de su especialidad principal (primera en `doctor_specialties`)
- Nombre y especialidad en el color de la especialidad (reutiliza `getSpecialtyColor` de `specialty-colors.ts`)
- Info secundaria en gris: ciudad, zona

**Filtros superiores:**

- Busqueda por nombre
- Filtro por especialidad, ciudad, zona, estado activo/inactivo
- Boton "Nuevo Doctor" abre formulario de creacion

**Click en tarjeta abre Dialog de detalle (solo lectura):**

- Nombre completo
- Telefono
- Direccion
- Especialidades (como badges con colores)
- Ciudad y zona
- Google Calendar (estado de conexion)
- Boton editar y toggle activar/desactivar
- Info login y contraseña de la plataforma
- Id del doctor

**CRUD:**

- **Crear doctor**: Formulario con nombre, telefono, direccion, email, contrasena temporal, ciudad, zona, especialidades. Llama a una edge function `create-doctor` que usa service role para crear auth user + doctor + users + user_roles + doctor_specialties atomicamente.
- **Editar doctor**: Dialog para actualizar nombre, telefono, direccion, ciudad, zona, especialidades (mutaciones directas, admin ya tiene RLS).
- **Activar/Desactivar**: Toggle de `is_active` directamente.

**Query principal:**

```typescript
supabase
  .from("doctors")
  .select(`
    id, full_name, phone, address, is_active, city_id, zone_id,
    google_calendar_connected,
    doctor_specialties(specialty_id, specialties(id, name)),
    cities(name), zones(name)
  `)
  .order("full_name")
```

---

### 2. Edge Function `create-doctor` (`supabase/functions/create-doctor/index.ts`)

Necesaria porque crear usuarios en auth requiere service role key.

**Flujo:**

1. Valida JWT del caller y verifica que sea admin (`is_admin_or_superadmin`)
2. Crea usuario en `auth.users` con `admin.createUser({ email, password, email_confirm: true })`
3. Inserta en `doctors` (full_name, phone, address, city_id, zone_id)
4. Inserta en `users` (id = auth user id, role: "doctor", doctor_id)
5. Inserta en `user_roles` (user_id, role: "doctor")
6. Inserta en `doctor_specialties` (doctor_id, specialty_ids[])
7. Retorna el doctor creado

**Recibe:** `{ email, password, full_name, phone, address, city_id, zone_id, doctor_id, specialty_ids[] }`

---

### 3. Pagina de Catalogos (`src/pages/admin/Catalogos.tsx`) - CRUD de ciudades, zonas y especialidades

**Interface:** 3 tabs usando componente `Tabs` de Radix:

- **Ciudades** - CRUD sobre tabla `cities`
- **Zonas** - CRUD sobre tabla `zones` (con filtro obligatorio por ciudad)
- **Especialidades** - CRUD sobre tabla `specialties`

**Cada tab contiene:**

- Tabla simple con columnas: Nombre, Estado (badge activo/inactivo), Acciones
- Boton "Agregar" abre Dialog con formulario (campo nombre, y para zonas un selector de ciudad)
- Boton editar abre Dialog para cambiar nombre
- Toggle de activar/desactivar (no borrado fisico)

**Queries:**

```typescript
supabase.from("cities").select("*").order("name")
supabase.from("zones").select("*, cities(name)").order("name")
supabase.from("specialties").select("*").order("name")
```

**Mutaciones con `useMutation` + invalidacion de queries:**

- Insert, Update nombre, Toggle `is_active`

---

### 4. Pagina de Inbox del Admin (`src/pages/admin/Inbox.tsx`) - Notificaciones

Reutiliza el mismo patron visual y logica del `DoctorInbox` existente, adaptado al admin:

- Consulta notificaciones con `recipient_role IN ('admin', 'superadmin')` (sin filtro de `doctor_id`)
- Muestra nombre del doctor asociado (join `doctors(full_name)` via `doctor_id`)
- Filtro por tipo de notificacion (mismos 5 tipos: scheduled, cancelled x3, completed)
- Marcar como leida individual y masivo
- Suscripcion realtime para actualizaciones en vivo
- Limit de 100 notificaciones

**Query:**

```typescript
supabase
  .from("notifications")
  .select("*, doctors(full_name)")
  .in("recipient_role", ["admin", "superadmin"])
  .order("created_at", { ascending: false })
  .limit(100)
```

---

### Resumen de archivos

**Archivos a crear:**

- `supabase/functions/create-doctor/index.ts` - Edge function para alta de doctores

**Archivos a reescribir (actualmente placeholders):**

- `src/pages/admin/Doctores.tsx`
- `src/pages/admin/Catalogos.tsx`
- `src/pages/admin/Inbox.tsx`

**Sin cambios necesarios en:**

- `App.tsx` (rutas ya existen)
- `AdminLayout.tsx` (navegacion ya configurada)
- Base de datos (tablas y RLS ya soportan todas las operaciones del admin)