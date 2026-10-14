import { lazy, type ComponentType } from "react";

// Route chunks are content-hashed. After a new Vercel deploy, a tab that was
// opened on the previous version still asks for the old chunk names; Vercel no
// longer has them and the SPA rewrite answers with index.html, so the dynamic
// import fails ("Failed to fetch dynamically imported module"). Reloading once
// picks up the new index.html and its new chunk names. The timestamp guard
// prevents a reload loop when the failure is something else (offline, a real
// bug): a second failure within the window is rethrown.
const RELOAD_KEY = "findmed:chunk-reload-at";
const RELOAD_WINDOW_MS = 10_000;

export function shouldReloadAfterChunkError(now: number, lastReloadAt: number | null): boolean {
  return lastReloadAt === null || now - lastReloadAt > RELOAD_WINDOW_MS;
}

function readLastReload(): number | null {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function markReload(now: number): boolean {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    // Without storage we cannot guard against a loop: do not reload.
    return false;
  }
}

export function lazyWithReload<T extends ComponentType<unknown>>(
  load: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await load();
    } catch (err) {
      const now = Date.now();
      if (shouldReloadAfterChunkError(now, readLastReload()) && markReload(now)) {
        window.location.reload();
        // Keep Suspense showing the fallback until the reload happens.
        return await new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
