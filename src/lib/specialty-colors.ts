// Predefined palette for specialty color coding
const SPECIALTY_COLORS = [
  "#E30050", // Rosa (Ginecología)
  "#16A34A", // Verde (Gastroenterología)
  "#DC2626", // Rojo (Cardiología)
  "#9333EA", // Morado (Dermatología)
  "#2563EB", // Azul (Pediatría)
  "#EA580C", // Naranja (Oftalmología)
  "#0D9488", // Teal (Neurología)
  "#6B7280", // Gris (Otras)
];

/**
 * Given a sorted list of specialty IDs, returns the color assigned to a specific specialty.
 * Colors cycle if there are more specialties than colors.
 */
export function getSpecialtyColor(
  specialtyId: string,
  sortedSpecialtyIds: string[]
): string {
  const idx = sortedSpecialtyIds.indexOf(specialtyId);
  if (idx === -1) return SPECIALTY_COLORS[SPECIALTY_COLORS.length - 1]; // fallback grey
  return SPECIALTY_COLORS[idx % SPECIALTY_COLORS.length];
}

export { SPECIALTY_COLORS };
