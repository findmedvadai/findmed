import { describe, expect, it } from "vitest";
import { checkCoordinates, coordinateText, hasCoordinates, mapUrl, parseCoordinate } from "./geo-coords";

describe("geo-coords", () => {
  it("parsea números con punto o coma; vacío es null", () => {
    expect(parseCoordinate(" 19.417 ")).toBe(19.417);
    expect(parseCoordinate("19,417")).toBe(19.417);
    expect(parseCoordinate("-99.16")).toBe(-99.16);
    expect(parseCoordinate("")).toBeNull();
    expect(Number.isNaN(parseCoordinate("19°25'"))).toBe(true);
    expect(Number.isNaN(parseCoordinate("abc"))).toBe(true);
  });

  it("acepta la pareja dentro de México y redondea a 6 decimales", () => {
    expect(checkCoordinates("19.4170001", "-99.16")).toEqual({ ok: true, latitude: 19.417, longitude: -99.16 });
    expect(checkCoordinates("", "")).toEqual({ ok: true, latitude: null, longitude: null });
  });

  it("rechaza mitades, valores fuera de México, signo olvidado e invertidos", () => {
    expect(checkCoordinates("19.4", "")).toMatchObject({ ok: false, field: "longitude" });
    expect(checkCoordinates("", "-99.1")).toMatchObject({ ok: false, field: "latitude" });
    expect(checkCoordinates("40.4", "-3.7")).toMatchObject({ ok: false, field: "latitude" });
    expect(checkCoordinates("19.4", "99.1")).toMatchObject({ ok: false, field: "longitude", message: expect.stringContaining("negativa") });
    expect(checkCoordinates("-99.1", "19.4")).toMatchObject({ ok: false, field: "both" });
    expect(checkCoordinates("x", "-99.1")).toMatchObject({ ok: false, field: "latitude" });
  });

  it("indicador y enlace de mapa", () => {
    expect(hasCoordinates({ latitude: 19.4, longitude: -99.1 })).toBe(true);
    expect(hasCoordinates({ latitude: null, longitude: null })).toBe(false);
    expect(hasCoordinates({})).toBe(false);
    expect(mapUrl(19.417, -99.16)).toBe("https://www.openstreetmap.org/?mlat=19.417&mlon=-99.16#map=15/19.417/-99.16");
    expect(coordinateText(null)).toBe("");
    expect(coordinateText(19.5)).toBe("19.5");
  });
});
