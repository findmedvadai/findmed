// Predefined palette for specialty color coding
const SPECIALTY_COLORS = [
  "#E30050", // Rosa
  "#16A34A", // Verde
  "#DC2626", // Rojo
  "#9333EA", // Morado
  "#2563EB", // Azul
  "#EA580C", // Naranja
  "#0D9488", // Teal
  "#6B7280", // Gris
];

const DEFAULT_COLOR = "#6B7280";

/**
 * Given a color map (specialty_id -> color from DB), returns the color for a specialty.
 * Falls back to grey if not found.
 */
export function getSpecialtyColor(
  specialtyId: string,
  colorMap: Record<string, string>
): string {
  return colorMap[specialtyId] || DEFAULT_COLOR;
}

export { SPECIALTY_COLORS, DEFAULT_COLOR };
