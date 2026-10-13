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
