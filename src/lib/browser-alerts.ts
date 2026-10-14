// Avisos del navegador para alertas de casos: sonido corto (Web Audio, sin
// dependencias) y notificación del sistema (Notification API) cuando el
// usuario dio permiso. Todo es best-effort: si el navegador no lo soporta o lo
// bloquea, el aviso en pantalla (toast) sigue funcionando.

export type BrowserAlertPermission = NotificationPermission | "unsupported";

const hasNotifications = () => typeof window !== "undefined" && "Notification" in window;

export function browserAlertPermission(): BrowserAlertPermission {
  return hasNotifications() ? Notification.permission : "unsupported";
}

/** Debe llamarse desde un clic del usuario (los navegadores lo exigen). */
export async function requestBrowserAlerts(): Promise<BrowserAlertPermission> {
  if (!hasNotifications()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Muestra una notificación del sistema; null si no hay permiso o el navegador no la permite. */
export function showBrowserAlert(o: { title: string; body?: string; tag: string; urgent?: boolean; onClick?: () => void }): Notification | null {
  if (browserAlertPermission() !== "granted") return null;
  try {
    const n = new Notification(o.title, { body: o.body, tag: o.tag, requireInteraction: !!o.urgent });
    n.onclick = () => {
      window.focus();
      o.onClick?.();
      n.close();
    };
    return n;
  } catch {
    // Algunos navegadores móviles solo permiten notificaciones desde un service worker.
    return null;
  }
}

// --- Sonido -----------------------------------------------------------------

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Los navegadores solo dejan sonar audio después de una interacción. Esto
 * "desbloquea" el audio con el primer clic o tecla en la página.
 */
export function primeAlertSound(): () => void {
  if (typeof window === "undefined") return () => {};
  const unlock = () => {
    audio()?.resume().catch(() => {});
    cleanup();
  };
  const cleanup = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  return cleanup;
}

/** Dos tonos cortos; cuatro si es urgente. */
export function playAlertSound(urgent = false): void {
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const tones = urgent ? [880, 660, 880, 660] : [660, 880];
  let t = c.currentTime + 0.02;
  for (const freq of tones) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.2);
    t += 0.22;
  }
}

// --- Varias pestañas ---------------------------------------------------------

const SEEN_KEY = "fm-case-alerts-seen";

/**
 * Con el panel abierto en varias pestañas, solo una suena y muestra la
 * notificación del sistema por alerta. true = esta pestaña se encarga.
 */
export function claimAlertOnce(id: string): boolean {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[];
    if (seen.includes(id)) return false;
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id].slice(-50)));
    return true;
  } catch {
    return true;
  }
}
