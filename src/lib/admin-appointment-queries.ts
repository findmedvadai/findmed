import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Prefijos de todas las vistas del admin que muestran citas. Crear, cancelar o
 * reagendar una cita cambia todas: el calendario (por semana), la lista de la
 * Agenda (?vista=lista), los eventos externos que se pintan junto a las citas,
 * el detalle abierto y los indicadores de Inicio.
 *
 * invalidateQueries compara por prefijo, así que ["admin-calendar-appointments"]
 * alcanza todas las semanas (["admin-calendar-appointments", "2026-10-11"], …).
 * Las vistas que no están montadas solo quedan marcadas como viejas y se
 * recargan al volver a ellas.
 */
export const ADMIN_APPOINTMENT_VIEW_PREFIXES: readonly QueryKey[] = [
  ["admin-calendar-appointments"],
  ["admin-reservas-appointments"],
  ["admin-calendar-google-events"],
  ["admin-calendar-outlook-events"],
  ["admin-appointment-detail"],
  ["admin-home-overview"],
];

/** Refresca el calendario, la lista y el detalle tras crear, cancelar o reagendar. */
export function invalidateAdminAppointmentViews(queryClient: QueryClient): Promise<void[]> {
  return Promise.all(
    ADMIN_APPOINTMENT_VIEW_PREFIXES.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
