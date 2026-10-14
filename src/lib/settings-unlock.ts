// Desbloqueo de las secciones sensibles de Configuración (webhooks, API keys).
//
// Antes se comparaba contra una contraseña fija escrita en el código, que
// viajaba en el bundle público (hallazgo N11). Ahora el admin confirma la
// contraseña de su propia cuenta (PasswordGate) y el desbloqueo se recuerda
// 30 minutos en sessionStorage, ligado a su id de usuario: otra cuenta en la
// misma pestaña no hereda el acceso.

export const SETTINGS_UNLOCK_STORAGE_KEY = "findmed_settings_unlock";
/** Clave del esquema anterior ({ unlocked, sessionId }); se borra al leer. */
const LEGACY_STORAGE_KEY = "findmed_settings_unlocked";
export const SETTINGS_UNLOCK_TTL_MS = 30 * 60 * 1000;

interface StoredUnlock {
  userId: string;
  expiresAt: number;
}

export function serializeSettingsUnlock(userId: string, now: number = Date.now()): string {
  const value: StoredUnlock = { userId, expiresAt: now + SETTINGS_UNLOCK_TTL_MS };
  return JSON.stringify(value);
}

/** true si `raw` es un desbloqueo vigente de `userId`. Cualquier otra cosa: false. */
export function isSettingsUnlockValid(
  raw: string | null | undefined,
  userId: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!raw || !userId) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredUnlock> | null;
    return (
      !!parsed &&
      parsed.userId === userId &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt > now &&
      // Un valor manipulado no puede alargar el desbloqueo más allá del TTL.
      parsed.expiresAt <= now + SETTINGS_UNLOCK_TTL_MS
    );
  } catch {
    return false;
  }
}

/** Lee sessionStorage sin romper si no está disponible (modo privado, iframes). */
export function hasValidSettingsUnlock(userId: string | null | undefined): boolean {
  try {
    sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    return isSettingsUnlockValid(sessionStorage.getItem(SETTINGS_UNLOCK_STORAGE_KEY), userId);
  } catch {
    return false;
  }
}

export function saveSettingsUnlock(userId: string): void {
  try {
    sessionStorage.setItem(SETTINGS_UNLOCK_STORAGE_KEY, serializeSettingsUnlock(userId));
  } catch {
    // Sin sessionStorage el desbloqueo dura lo que la vista abierta.
  }
}

/** Mensaje para el admin según el error de Supabase Auth al verificar la contraseña. */
export function settingsUnlockErrorMessage(error: { status?: number; code?: string } | null | undefined): string {
  if (error?.status === 429 || error?.code === "over_request_rate_limit") {
    return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
  }
  if (error?.code === "invalid_credentials" || error?.status === 400) {
    return "Contraseña incorrecta.";
  }
  return "No se pudo verificar la contraseña. Revisa tu conexión e inténtalo de nuevo.";
}
