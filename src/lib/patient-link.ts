// Respuestas de las Edge Functions públicas del paciente (/reserva, /gestionar):
// textos para personas y lectura robusta de la respuesta.

/** Mensaje para el paciente a partir del error de reserve-validate / manage-validate. */
export function patientLinkError(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg || /token (inválido|requerido)/i.test(msg)) {
    return "Este enlace no es válido. Revisa que lo hayas abierto completo desde el mensaje de WhatsApp.";
  }
  return msg;
}

export const PATIENT_LINK_HELP = "Si necesitas ayuda, escríbenos por WhatsApp y te enviamos un enlace nuevo.";

export const CONNECTION_ERROR = "No pudimos conectarnos. Revisa tu conexión a internet e intenta de nuevo.";

/**
 * Lee la respuesta de una Edge Function pública. Una respuesta no-2xx sin
 * `error` (p. ej. la plataforma respondiendo 503 con otro formato) o que no es
 * JSON cuenta como error: antes se tomaba como datos válidos y la página se
 * pintaba con campos vacíos.
 */
export async function readPatientResponse<T>(res: Response): Promise<{ data: T | null; error: string | null }> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return { data: null, error: CONNECTION_ERROR };
  }
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (obj && typeof obj.error === "string") return { data: null, error: obj.error };
  if (!res.ok || !obj) return { data: null, error: CONNECTION_ERROR };
  return { data: obj as T, error: null };
}
