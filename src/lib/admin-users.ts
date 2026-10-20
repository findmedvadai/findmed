// Usuarios del equipo (Configuración → Usuarios): llamada a la Edge Function
// admin-users, reglas de contraseña (las mismas que valida el servidor) y el
// texto para compartir los datos de acceso. Los médicos no se gestionan aquí.
import { supabase } from "@/integrations/supabase/client";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";
import { secureRandomString } from "@/lib/secure-random";

export type TeamRole = "admin" | "superadmin";

export interface TeamUser {
  id: string;
  email: string | null;
  role: TeamRole;
  created_at: string | null;
  last_sign_in_at: string | null;
  /** active: puede entrar · disabled: acceso desactivado · unknown: no se pudo verificar. */
  status: "active" | "disabled" | "unknown";
  is_self: boolean;
}

export interface TeamUsersList {
  users: TeamUser[];
  viewer: { id: string; is_superadmin: boolean };
}

export const ADMIN_USERS_KEY = ["admin-users"] as const;
export const LOGIN_URL = "https://app.findmed.com.mx/login";
export const MIN_PASSWORD = 8;

export const ROLE_LABEL: Record<TeamRole, string> = {
  admin: "Administrador",
  superadmin: "Superadministrador",
};

/**
 * Llama a admin-users. En error lanza un Error con el mensaje del servidor en
 * español (o el error de red original, que `userErrorMessage` traduce).
 */
export async function adminUsersAction<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await supabase.functions.invoke("admin-users", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.error) {
    const parsed = await extractEdgeFunctionError(res.error);
    if (parsed.code === "network_error") throw res.error;
    const err = new Error(parsed.message ?? "No se pudo completar la acción.") as Error & { errorCode?: string };
    err.errorCode = parsed.code ?? undefined;
    throw err;
  }
  return res.data as T;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Motivo en español por el que se rechaza una contraseña, o null si es válida. */
export function passwordProblem(password: string): string | null {
  if (!password) return "Escribe la contraseña.";
  if (password.trim() !== password) return "No puede empezar ni terminar con espacios.";
  if (password.length < MIN_PASSWORD) return `Debe tener al menos ${MIN_PASSWORD} caracteres, con letras y números.`;
  if (new TextEncoder().encode(password).length > 72) return "No puede pasar de 72 caracteres.";
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return "Debe combinar letras y números.";
  return null;
}

/** Sin caracteres que se confunden al dictarlos o copiarlos a mano (0/O, 1/l/I). */
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Contraseña aleatoria segura (CSPRNG) que siempre pasa las reglas. */
export function generatePassword(length = 14): string {
  for (;;) {
    const candidate = secureRandomString(PASSWORD_ALPHABET, length);
    if (passwordProblem(candidate) === null) return candidate;
  }
}

/** Texto listo para pegar en un mensaje privado. */
export function accessShareText(email: string, password: string): string {
  return [
    "Tus datos de acceso a FindMed:",
    `Correo: ${email}`,
    `Contraseña: ${password}`,
    `Entra en: ${LOGIN_URL}`,
  ].join("\n");
}
