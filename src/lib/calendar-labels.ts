// Etiquetas ARIA en español para el calendario (react-day-picker v8). El
// `locale` de date-fns solo traduce meses y días: los botones de navegación
// seguirían diciendo "Go to previous month". Se pasan desde cada página que usa
// <Calendar> (src/components/ui/calendar.tsx no se edita).
import type { Labels } from "react-day-picker";

export const CALENDAR_LABELS_ES: Partial<Labels> = {
  labelPrevious: () => "Ir al mes anterior",
  labelNext: () => "Ir al mes siguiente",
  labelMonthDropdown: () => "Mes",
  labelYearDropdown: () => "Año",
  labelWeekNumber: (n) => `Semana ${n}`,
};
