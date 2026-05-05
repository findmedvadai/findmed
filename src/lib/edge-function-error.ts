// Helpers para mostrar errores de Edge Functions en español sin exponer
// strings técnicos al usuario.
//
// El SDK de Supabase envuelve errores HTTP en `FunctionsHttpError`, cuyo
// `message` por defecto es "Edge Function returned a non-2xx status code"
// — completamente inútil para el usuario. La respuesta real (con código y
// mensaje estructurado) vive en el Response sin parsear que el SDK guarda
// en `error.context`. Este módulo lo extrae y lo traduce.

export interface EdgeFunctionError {
  /** Código machine-readable devuelto por la EF (ej. "email_taken"). */
  code: string | null;
  /** Mensaje human-readable devuelto por la EF, o null si no había. */
  message: string | null;
  /** Status HTTP del response. */
  status: number | null;
}

/**
 * Extrae el shape `{error, message}` que devuelven las EFs de FindMed desde
 * un error capturado del SDK de Supabase. Maneja tanto FunctionsHttpError
 * (con context: Response) como errores genéricos.
 */
export async function extractEdgeFunctionError(err: unknown): Promise<EdgeFunctionError> {
  const e = err as { message?: string; context?: Response };
  const ctx = e?.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const json = await ctx.clone().json();
      return {
        code: typeof json?.error === "string" ? json.error : null,
        message: typeof json?.message === "string" ? json.message : null,
        status: ctx.status ?? null,
      };
    } catch {
      // El body no era JSON (texto plano, vacío, o ya consumido).
    }
  }
  return { code: null, message: e?.message ?? null, status: null };
}

/**
 * Diccionario de códigos → mensajes en español. Se aplica como fallback
 * cuando la EF no incluyó `message`, y para garantizar consistencia entre
 * los flujos de create-doctor y update-doctor-credentials.
 */
const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  unauthorized: {
    title: "Sesión expirada",
    description: "Vuelve a iniciar sesión para continuar.",
  },
  forbidden: {
    title: "Sin permisos",
    description: "Tu cuenta no puede realizar esta acción. Contacta al administrador.",
  },
  email_taken: {
    title: "Email ya registrado",
    description: "Ese email pertenece a otra cuenta. Usa uno diferente.",
  },
  invalid_email: {
    title: "Email inválido",
    description: "Verifica el formato del correo (ej. doctor@findmed.com).",
  },
  weak_password: {
    title: "Contraseña insegura",
    description: "Debe tener al menos 6 caracteres. Usa una más larga.",
  },
  missing_fields: {
    title: "Campos incompletos",
    description: "Completa todos los campos marcados con asterisco.",
  },
  user_not_found: {
    title: "Usuario no encontrado",
    description: "No se encontró el usuario asociado al doctor.",
  },
  invalid_input: {
    title: "Datos inválidos",
    description: "Revisa los campos del formulario y vuelve a intentar.",
  },
  internal_error: {
    title: "Error inesperado",
    description: "Ocurrió un error en el servidor. Intenta de nuevo en unos segundos.",
  },
  network_error: {
    title: "Error de conexión",
    description: "Verifica tu conexión a internet y vuelve a intentar.",
  },
};

/**
 * Convierte un EdgeFunctionError en {title, description} listo para
 * mostrar en un toast. Prioriza el mapping local sobre el `message` del
 * backend para tener consistencia, pero usa el `message` del backend
 * cuando aporta info adicional (ej. especifica el campo faltante).
 */
export function toastFromEdgeFunctionError(
  err: EdgeFunctionError,
  fallbackTitle = "Error inesperado"
): { title: string; description: string } {
  if (err.code && ERROR_MESSAGES[err.code]) {
    const mapped = ERROR_MESSAGES[err.code];
    // Si el backend envió un mensaje específico, lo usamos como descripción
    // (puede tener detalle que el genérico no, ej. "Falta el campo X").
    return {
      title: mapped.title,
      description: err.message ?? mapped.description,
    };
  }
  // Sin código conocido: mostrar mensaje del backend si lo hay, o un genérico.
  // Nunca exponemos strings como "Edge Function returned a non-2xx status code".
  const isTechnicalLeak =
    !!err.message &&
    /non-2xx|stack|undefined is not|TypeError|JSON\.parse/i.test(err.message);
  return {
    title: fallbackTitle,
    description: !err.message || isTechnicalLeak
      ? "Ocurrió un error inesperado. Intenta de nuevo en unos segundos."
      : err.message,
  };
}
