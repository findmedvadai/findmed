

## Agregar popup de detalle de cita al hacer click en notificaciones del Inbox Admin

### Que cambia

Actualmente las tarjetas de notificacion en el Inbox del admin solo muestran un resumen (titulo, body, doctor, fecha). Con este cambio, al hacer click en una tarjeta que tenga `appointment_id`, se abrira un Dialog con la informacion completa de la cita.

### Informacion que mostrara el popup

- Nombre del paciente y telefono
- Nombre del doctor
- Especialidad(es) del doctor
- Fecha y horario de la cita (inicio - fin)
- Estado de la cita (badge con color)
- Sintomas iniciales del paciente
- Notas medicas del doctor
- Fecha de cuando se agregaron las notas

### Implementacion

**Archivo nuevo**: `src/components/admin/AppointmentDetailDialog.tsx`

- Componente Dialog que recibe un `appointmentId` y un flag `open`
- Al abrirse, hace un query a `appointments` con joins:
  ```
  appointments.select("*, patients(full_name, phone), doctors(full_name, doctor_specialties(specialty_id, specialties(name)))")
  ```
- Muestra la informacion organizada en secciones claras
- Read-only (sin acciones de editar/cancelar, es solo para contexto del admin)

**Archivo modificado**: `src/pages/admin/Inbox.tsx`

- Agregar estado `selectedAppointmentId` (string | null)
- Hacer las tarjetas clickeables (`cursor-pointer` + `onClick`) solo cuando tengan `appointment_id`
- Al hacer click, setear el `selectedAppointmentId` y marcar como leida
- Renderizar el nuevo `AppointmentDetailDialog` al final del componente

### Detalle tecnico

El query del dialog sera:
```typescript
const { data } = await supabase
  .from("appointments")
  .select(`
    id, start_at, end_at, status, symptoms,
    doctor_notes, doctor_notes_updated_at,
    patients(full_name, phone),
    doctors(full_name, doctor_specialties(specialties(name)))
  `)
  .eq("id", appointmentId)
  .single();
```

La UI del dialog tendra secciones con iconos y labels para cada campo, similar al estilo del `AppointmentDetailDialog` del doctor pero sin acciones de edicion. Se usaran los componentes Dialog existentes del proyecto.

