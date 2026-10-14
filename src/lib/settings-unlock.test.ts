import { afterEach, describe, it, expect } from "vitest";
import {
  SETTINGS_UNLOCK_STORAGE_KEY,
  SETTINGS_UNLOCK_TTL_MS,
  hasValidSettingsUnlock,
  isSettingsUnlockValid,
  saveSettingsUnlock,
  serializeSettingsUnlock,
  settingsUnlockErrorMessage,
} from "./settings-unlock";

const NOW = Date.parse("2026-10-13T18:00:00Z");
const ADMIN = "admin-uuid";

describe("isSettingsUnlockValid", () => {
  it("vale 30 minutos para la misma cuenta", () => {
    const raw = serializeSettingsUnlock(ADMIN, NOW);
    expect(isSettingsUnlockValid(raw, ADMIN, NOW)).toBe(true);
    expect(isSettingsUnlockValid(raw, ADMIN, NOW + SETTINGS_UNLOCK_TTL_MS - 1)).toBe(true);
    expect(isSettingsUnlockValid(raw, ADMIN, NOW + SETTINGS_UNLOCK_TTL_MS)).toBe(false);
  });

  it("no lo hereda otra cuenta en la misma pestaña", () => {
    const raw = serializeSettingsUnlock(ADMIN, NOW);
    expect(isSettingsUnlockValid(raw, "otro-admin", NOW)).toBe(false);
    expect(isSettingsUnlockValid(raw, null, NOW)).toBe(false);
  });

  it("rechaza valores vacíos, corruptos, del esquema anterior o alargados a mano", () => {
    expect(isSettingsUnlockValid(null, ADMIN, NOW)).toBe(false);
    expect(isSettingsUnlockValid("{no json", ADMIN, NOW)).toBe(false);
    expect(isSettingsUnlockValid("null", ADMIN, NOW)).toBe(false);
    expect(isSettingsUnlockValid(JSON.stringify({ unlocked: true, sessionId: "jwt" }), ADMIN, NOW)).toBe(false);
    const forever = JSON.stringify({ userId: ADMIN, expiresAt: NOW + 365 * 24 * 3600 * 1000 });
    expect(isSettingsUnlockValid(forever, ADMIN, NOW)).toBe(false);
  });
});

describe("sessionStorage", () => {
  afterEach(() => sessionStorage.clear());

  it("guarda y lee el desbloqueo de la cuenta conectada", () => {
    expect(hasValidSettingsUnlock(ADMIN)).toBe(false);
    saveSettingsUnlock(ADMIN);
    expect(hasValidSettingsUnlock(ADMIN)).toBe(true);
    expect(hasValidSettingsUnlock("otro-admin")).toBe(false);
    expect(sessionStorage.getItem(SETTINGS_UNLOCK_STORAGE_KEY)).toContain(ADMIN);
  });

  it("borra la marca del esquema anterior (contraseña fija)", () => {
    sessionStorage.setItem("findmed_settings_unlocked", JSON.stringify({ unlocked: true, sessionId: "x" }));
    expect(hasValidSettingsUnlock(ADMIN)).toBe(false);
    expect(sessionStorage.getItem("findmed_settings_unlocked")).toBeNull();
  });
});

describe("settingsUnlockErrorMessage", () => {
  it("traduce los errores de Supabase Auth a mensajes claros", () => {
    expect(settingsUnlockErrorMessage({ status: 400, code: "invalid_credentials" })).toBe("Contraseña incorrecta.");
    expect(settingsUnlockErrorMessage({ status: 429 })).toMatch(/Demasiados intentos/);
    expect(settingsUnlockErrorMessage({ status: 500 })).toMatch(/No se pudo verificar/);
    expect(settingsUnlockErrorMessage(null)).toMatch(/No se pudo verificar/);
  });
});
