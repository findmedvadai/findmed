

## Problema

El payload **real** del webhook `postconsultation.report_sent` sí envía toda la data del formulario (está dentro de `payload.form` con un `select("*")`). Sin embargo, el **ejemplo visual** en la página de Webhooks (líneas 178-193 de `Webhooks.tsx`) solo muestra `observations` y `hospitalization`, lo que genera confusión.

Además, la estructura del ejemplo no coincide con la estructura real: el dispatch envía los campos del formulario dentro de un objeto `form`, pero el ejemplo los pone a nivel raíz.

## Cambios

### `src/pages/admin/Webhooks.tsx` (líneas 178-193)

Actualizar el ejemplo de `postconsultation.report_sent` para incluir todos los campos del formulario y reflejar la estructura real del payload:

```js
"postconsultation.report_sent": {
  appointment_id: "uuid-example",
  patient_name: "Karla Gamez",
  patient_phone: "+521234567890",
  doctor_name: "Dr. Juan Pérez",
  start_at: "2026-03-15T10:00:00-06:00",
  form: {
    id: "uuid-example",
    appointment_id: "uuid-example",
    doctor_id: "uuid-example",
    observations: "Paciente requiere cirugía.",
    prescribed_medications: "Ibuprofeno 400mg cada 8 horas",
    imaging_studies: null,
    lab_tests: "Biometría hemática completa",
    specialist_referral: null,
    hospitalization: "Hospital General, cirugía programada, urgente",
    review_status: "report_sent",
    report_destination_type: "hospital",
    report_destination_id: "uuid-example",
    report_sent_at: "2026-03-10T20:05:41.848Z",
    created_at: "2026-03-10T18:00:00.000Z",
  },
  destination_type: "hospital",
  destination: {
    name: "Hospital General",
    phone: "+525555555555",
    email: "contacto@hospital.com",
    city: "CDMX",
    zone: "Centro",
  },
}
```

Esto alinea el ejemplo con lo que realmente envía `SendReportModal.tsx`.

