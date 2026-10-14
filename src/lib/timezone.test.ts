import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { es } from "date-fns/locale";
import {
  formatMx,
  isBeforeMexicoToday,
  mexicoTodayPickerDate,
  mexicoDayLabel,
  mexicoTodayYmd,
  pickerDateToYmd,
} from "./timezone";

// Las aserciones usan instantes absolutos (UTC), así que valen con cualquier
// zona horaria en la máquina que corre las pruebas. CDMX es UTC-06:00 fijo.

describe("formatMx", () => {
  it("muestra la hora de CDMX sin importar la zona del navegador", () => {
    const start = new Date("2026-10-20T16:30:00Z"); // 10:30 en CDMX
    expect(formatMx(start, "HH:mm")).toBe("10:30");
    expect(formatMx(start, "EEEE d 'de' MMMM, yyyy", { locale: es })).toBe("martes 20 de octubre, 2026");
  });

  it("una cita de noche en CDMX no se recorre al día siguiente", () => {
    const start = new Date("2026-10-21T03:00:00Z"); // 21:00 del 20 en CDMX
    expect(formatMx(start, "yyyy-MM-dd HH:mm")).toBe("2026-10-20 21:00");
  });
});

describe("mexicoTodayYmd", () => {
  it("cambia de día a la medianoche de CDMX, no a la del navegador", () => {
    expect(mexicoTodayYmd(new Date("2026-10-16T05:59:00Z"))).toBe("2026-10-15");
    expect(mexicoTodayYmd(new Date("2026-10-16T06:00:00Z"))).toBe("2026-10-16");
  });
});

describe("mexicoTodayPickerDate", () => {
  it("es la medianoche local del día de hoy en CDMX", () => {
    const d = mexicoTodayPickerDate(new Date("2026-10-15T23:30:00Z")); // 17:30 del 15 en CDMX
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 15]);
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
    expect(pickerDateToYmd(d)).toBe("2026-10-15");
  });
});

describe("isBeforeMexicoToday", () => {
  // Paciente en Madrid a la 01:30 del 16 = 17:30 del 15 en CDMX.
  const now = new Date("2026-10-15T23:30:00Z");

  it("deja elegir el día de hoy en CDMX aunque en el navegador ya sea mañana", () => {
    expect(isBeforeMexicoToday(new Date(2026, 9, 15), now)).toBe(false);
    expect(isBeforeMexicoToday(new Date(2026, 9, 16), now)).toBe(false);
  });

  it("bloquea los días que ya pasaron en CDMX", () => {
    expect(isBeforeMexicoToday(new Date(2026, 9, 14), now)).toBe(true);
  });

  // QA 2026-10-14: las notificaciones del admin/doctor se agrupaban por el día
  // del navegador ("Ayer" a las 22:20 CDMX visto desde Madrid era "Hoy").
  it("agrupa notificaciones por el día de CDMX", () => {
    const now = new Date("2026-10-14T16:20:00Z"); // 10:20 del 14 en CDMX
    expect(mexicoDayLabel(new Date("2026-10-14T04:20:00Z"), now)).toBe("Ayer"); // 22:20 del 13 en CDMX
    expect(mexicoDayLabel(new Date("2026-10-14T07:00:00Z"), now)).toBe("Hoy"); // 01:00 del 14 en CDMX
    expect(mexicoDayLabel(new Date("2026-10-12T18:00:00Z"), now)).toBe("Lunes 12 de octubre");
  });

  it("bloquea ayer en CDMX aunque en el navegador (p. ej. Hawái) aún sea ese día", () => {
    // 02:00 del 16 en CDMX; en Hawái (UTC-10) siguen siendo las 22:00 del 15.
    const late = new Date("2026-10-16T08:00:00Z");
    expect(isBeforeMexicoToday(new Date(2026, 9, 15), late)).toBe(true);
    expect(isBeforeMexicoToday(new Date(2026, 9, 16), late)).toBe(false);
  });
});

describe("pickerDateToYmd", () => {
  it("usa el día de la celda elegida (medianoche local)", () => {
    expect(pickerDateToYmd(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

// Simula el navegador de un paciente fuera de CDMX (Node aplica process.env.TZ
// en caliente). Se restaura al terminar.
describe.each(["Europe/Madrid", "Pacific/Honolulu", "Asia/Tokyo"])("navegador en %s", (tz) => {
  const prevTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it("la hora de la cita se muestra en CDMX", () => {
    // La simulación sí aplica: el navegador no está en UTC-06:00.
    expect(new Date(2026, 9, 15).getTimezoneOffset()).not.toBe(360);
    expect(formatMx(new Date("2026-10-20T16:30:00Z"), "yyyy-MM-dd HH:mm")).toBe("2026-10-20 10:30");
  });

  it("el calendario marca como hoy el día de CDMX y no se recorre", () => {
    const now = new Date("2026-10-15T23:30:00Z"); // 17:30 del 15 en CDMX
    const today = mexicoTodayPickerDate(now);
    expect(pickerDateToYmd(today)).toBe("2026-10-15");
    // La celda "15" del calendario (medianoche local) se puede elegir y se
    // envía como 2026-10-15; la "14" queda bloqueada.
    const picked15 = new Date(2026, 9, 15);
    expect(isBeforeMexicoToday(picked15, now)).toBe(false);
    expect(pickerDateToYmd(picked15)).toBe("2026-10-15");
    expect(isBeforeMexicoToday(new Date(2026, 9, 14), now)).toBe(true);
  });

  // QA 2026-10-14: las notificaciones del admin/doctor se agrupaban por el día
  // del navegador ("Ayer" a las 22:20 CDMX visto desde Madrid era "Hoy").
  it("agrupa notificaciones por el día de CDMX", () => {
    const now = new Date("2026-10-14T16:20:00Z"); // 10:20 del 14 en CDMX
    expect(mexicoDayLabel(new Date("2026-10-14T04:20:00Z"), now)).toBe("Ayer"); // 22:20 del 13 en CDMX
    expect(mexicoDayLabel(new Date("2026-10-14T07:00:00Z"), now)).toBe("Hoy"); // 01:00 del 14 en CDMX
    expect(mexicoDayLabel(new Date("2026-10-12T18:00:00Z"), now)).toBe("Lunes 12 de octubre");
  });
});
