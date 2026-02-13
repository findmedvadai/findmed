

## Modal de Detalle de Cita en la Agenda Semanal

Al hacer clic en un evento del calendario semanal, se abre un Dialog con los detalles de la cita y acciones disponibles para el doctor.

### Informacion mostrada

**Para citas locales (appointments):**
- Nombre del paciente y telefono
- Fecha y hora (inicio - fin)
- Sintomas reportados
- Estado actual (badge de color)
- Notas medicas (si existen)

**Para eventos de Google Calendar:**
- Nombre del evento, fecha y hora
- Sin acciones (solo lectura)

### Acciones del doctor segun estado

```text
Estado actual     Acciones disponibles
--------------    ---------------------
scheduled         [Cancelar]
confirmed         [Completar*] [Cancelar]
completed         [Editar notas]
cancelled         (solo lectura)

* Completar solo habilitado si la hora de inicio ya paso
```

El doctor NO puede confirmar citas. La confirmacion la realiza el paciente.

### Reglas de negocio

- **Cancelar**: cambia status a "cancelled" con cancel_reason = "doctor". Se muestra AlertDialog de confirmacion antes de proceder.
- **Completar**: solo si status es "confirmed" Y la hora de inicio ya paso; cambia a "completed".
- **Editar notas**: permite escribir/actualizar doctor_notes en citas completadas, guarda tambien doctor_notes_updated_at.
- No se permite mover citas a otros horarios.

### Detalle Tecnico

**Nuevo archivo:** `src/components/doctor/AppointmentDetailDialog.tsx`

- Componente Dialog de shadcn/ui que recibe el CalendarItem seleccionado y controles open/onClose
- Usa useMutation con supabase para cancelar, completar y guardar notas
- Cada mutacion invalida la query "doctor-appointments" para refrescar el calendario
- Para cancelar muestra AlertDialog de confirmacion
- Incluye Textarea para notas medicas en citas completadas
- Boton de completar deshabilitado si item.start > now

**Archivo modificado:** `src/pages/doctor/Agenda.tsx`

- Agrega estado selectedItem (CalendarItem | null)
- Cambia cursor-default a cursor-pointer en eventos
- Agrega onClick en cada evento para abrir el dialog
- Renderiza AppointmentDetailDialog con el item seleccionado

Sin cambios en base de datos, edge functions ni RLS.

