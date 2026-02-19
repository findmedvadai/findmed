

## Resultados de las pruebas y bugs encontrados

### Resumen de pruebas realizadas

| Flujo | Resultado | Bugs encontrados |
|---|---|---|
| 1. Auto-cancelacion | FALLA | La funcion `auto-cancel-unconfirmed` esta rota - error 500 |
| 2. Confirmacion 48h | PARCIAL | `send-appointment-reminders` funciona, pero la UI despues de reagendar muestra status incorrecto |
| 3. Cancelacion doctor | OK | `cancel-by-doctor` funciona, Google Calendar se borra, webhook se dispara, link de reagendamiento funciona |
| 4. Recordatorio 8am | OK | `send-day-of-reminders` funciona correctamente |

### Pruebas detalladas

**Flujo 1 - Auto-cancelacion**: Al llamar `auto-cancel-unconfirmed`, devuelve error 500:
```
"Could not find a relationship between 'appointments' and 'doctor_schedule_settings' in the schema cache"
```
La causa es que el query usa un join invalido: `doctor_schedule_settings!appointments_doctor_id_fkey`. No existe un foreign key entre `appointments` y `doctor_schedule_settings`. La solucion es consultar la tabla `doctor_schedule_settings` por separado para cada cita.

**Flujo 2 - Confirmacion 48h**: El webhook `send-appointment-reminders` funciona correctamente (busca citas scheduled en ventana 47-49h). Sin embargo, se encontro un bug en la UI: despues de reagendar una cita, el componente `Gestionar.tsx` siempre establece el status como `"scheduled"` en linea 178, sin importar que el backend la haya auto-confirmado. Esto causa:
- La UI muestra "Reservada" cuando deberia mostrar "Confirmada"
- Aparece el boton "Confirmar cita" innecesariamente
- Al intentar confirmar, el backend devuelve 409 porque ya esta confirmada

**Flujo 3 - Cancelacion doctor**: Verificado completamente:
- La cita se cancela en la plataforma
- El evento de Google Calendar se elimina
- El webhook `appointment.cancelled_by_doctor` se dispara con `reschedule_url`
- El link de reagendamiento funciona: muestra calendario, slots disponibles, y permite reagendar exitosamente
- La nueva cita se crea con Google Calendar event

**Flujo 4 - Recordatorio 8am**: `send-day-of-reminders` se ejecuta correctamente. Busca citas confirmadas del dia actual en zona horaria Mexico City. Dispara `appointment.reminder_day_of` con `manage_url`. Cuando no hay citas, devuelve `processed: 0`.

---

### Plan de correccion: 2 bugs criticos

#### Bug 1: `auto-cancel-unconfirmed` roto (critico)

**Archivo**: `supabase/functions/auto-cancel-unconfirmed/index.ts`

**Problema**: Linea 37 usa `doctor_schedule_settings!appointments_doctor_id_fkey(min_confirm_hours_before)` en el select de appointments. No existe esta relacion FK.

**Solucion**: Eliminar el join de `doctor_schedule_settings` del query principal. En su lugar, dentro del loop de cada appointment, hacer un query separado:

```text
// Quitar doctor_schedule_settings del select principal
const { data: appointments } = await supabase
  .from("appointments")
  .select("id, start_at, end_at, doctor_id, patient_id, doctors(full_name), patients(full_name, phone)")
  .eq("status", "scheduled")
  .gt("start_at", now.toISOString());

// Dentro del loop:
for (const appt of appointments) {
  const { data: settings } = await supabase
    .from("doctor_schedule_settings")
    .select("min_confirm_hours_before")
    .eq("doctor_id", appt.doctor_id)
    .maybeSingle();

  const minHours = settings?.min_confirm_hours_before ?? 24;
  // ... resto de la logica igual
}
```

#### Bug 2: Gestionar.tsx muestra status incorrecto despues de reagendar

**Archivo**: `src/pages/patient/Gestionar.tsx` linea 178 y `supabase/functions/manage-reschedule/index.ts` linea 291-300

**Problema**: `manage-reschedule` no devuelve el campo `status` en la respuesta. `Gestionar.tsx` hardcodea `status: "scheduled"` despues de reagendar.

**Solucion en dos partes**:

1. En `manage-reschedule/index.ts`, agregar `status: newStatus` a la respuesta (linea 295):
```text
JSON.stringify({
  success: true,
  appointment_id: newAppt.id,
  status: newStatus,     // <-- agregar
  doctor_name: ...,
  ...
})
```

2. En `Gestionar.tsx` linea 178, usar el status que devuelve el backend:
```text
setAppointment((prev) =>
  prev ? {
    ...prev,
    appointment_id: data.appointment_id,
    start_at: data.start_at,
    end_at: data.end_at,
    status: data.status || "scheduled",  // <-- usar status real
    patient_name: data.patient_name,
  } : prev
);
```

---

### Resumen de archivos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/auto-cancel-unconfirmed/index.ts` | Eliminar join invalido con doctor_schedule_settings; consultar settings por separado dentro del loop |
| `supabase/functions/manage-reschedule/index.ts` | Agregar `status: newStatus` a la respuesta JSON |
| `src/pages/patient/Gestionar.tsx` | Usar `data.status` en vez de hardcodear `"scheduled"` despues de reagendar |

### Re-pruebas despues de la correccion

1. Llamar `auto-cancel-unconfirmed` y verificar que devuelve 200
2. Reagendar una cita dentro de 48h y verificar que la UI muestra "Confirmada"
3. Verificar que el boton "Confirmar cita" no aparece para citas ya confirmadas

