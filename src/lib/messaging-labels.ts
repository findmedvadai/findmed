// Etiquetas en español del centro de mensajería (variables que llena FindMed
// y estados de cita que disparan mensajes). Ver _shared/template-catalog.ts.

export const PARAM_LABEL: Record<string, string> = {
  patient_name: "Nombre del paciente",
  start_local: "Fecha y hora de la cita",
  previous_start_local: "Fecha y hora anterior (reagenda)",
  doctor_name: "Nombre del médico",
  office_address: "Dirección del consultorio",
  min_confirm_hours: "Horas para confirmar",
};

export const STATUS_LABEL: Record<string, string> = {
  scheduled: "Reservada",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  completed: "Completada",
};

export const CANCEL_REASON_LABEL: Record<string, string> = {
  patient: "por el paciente",
  doctor: "por el doctor",
  admin: "por FindMed",
  no_confirmation: "sin confirmar",
};

/** Cómo se llama cada evento para el equipo y cuándo ocurre (orden = orden en pantalla). */
export const EVENT_INFO: Record<string, { title: string; when: string; internal?: boolean }> = {
  "appointment.status_changed": { title: "Cambio de estado de la cita", when: "Al reservar, confirmar, cancelar el paciente o completarse la consulta." },
  "appointment.reminder_48h": { title: "Recordatorio para confirmar", when: "Dos días antes de una cita que aún no se confirma." },
  "appointment.reminder_day_of": { title: "Recordatorio del día", when: "La mañana de una cita confirmada." },
  "appointment.rescheduled_by_staff": { title: "Reagendada por el consultorio", when: "Cuando el doctor o FindMed mueven la cita." },
  "appointment.cancelled_by_doctor": { title: "Cancelada por el doctor", when: "Cuando el doctor cancela desde su agenda." },
  "appointment.auto_cancelled": { title: "Cancelación automática", when: "Cuando el paciente no confirmó a tiempo." },
  "postconsultation.submitted": { title: "Reporte post-consulta del doctor", when: "El doctor llena sus notas después de la consulta.", internal: true },
  "postconsultation.report_sent": { title: "Informe enviado a hospital o laboratorio", when: "FindMed envía el reporte al destino elegido.", internal: true },
};
