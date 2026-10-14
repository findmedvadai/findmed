import { describe, expect, it } from "vitest";
import { extractEdgeFunctionError, toastFromEdgeFunctionError, userErrorMessage } from "./edge-function-error";

describe("extractEdgeFunctionError", () => {
  it("lee el mensaje en español del cuerpo de un FunctionsHttpError", async () => {
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: new Response(JSON.stringify({ error: "take_first", message: "Primero toma el caso." }), { status: 409 }),
    });
    const parsed = await extractEdgeFunctionError(err);
    expect(parsed).toEqual({ code: "take_first", message: "Primero toma el caso.", status: 409 });
    expect(toastFromEdgeFunctionError(parsed, "No se pudo").description).toBe("Primero toma el caso.");
  });

  // QA 2026-10-14: sin red, el SDK lanza FunctionsFetchError con un mensaje en
  // inglés ("Failed to send a request to the Edge Function") que llegaba al toast.
  it("traduce una caída de red a un mensaje en español", async () => {
    const err = Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" });
    const t = toastFromEdgeFunctionError(await extractEdgeFunctionError(err), "No se pudo crear el caso");
    expect(t.title).toBe("Error de conexión");
    expect(t.description).not.toMatch(/Failed|Edge Function/);
  });

  it("también reconoce el TypeError de fetch", async () => {
    const t = toastFromEdgeFunctionError(await extractEdgeFunctionError(new TypeError("Failed to fetch")));
    expect(t.title).toBe("Error de conexión");
  });

  it("nunca muestra el mensaje técnico del SDK", async () => {
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response("<html>Bad gateway</html>", { status: 502 }),
    });
    const t = toastFromEdgeFunctionError(await extractEdgeFunctionError(err), "No se pudo");
    expect(t.description).not.toMatch(/non-2xx/);
  });
});

describe("userErrorMessage (base de datos)", () => {
  it("muestra el mensaje en español de la guarda de la base", () => {
    expect(userErrorMessage({ code: "42501", message: "Cambio de estado no permitido: usa cancelar o reagendar" }, "No se pudo")).toBe(
      "Cambio de estado no permitido: usa cancelar o reagendar",
    );
  });
  it("no muestra mensajes técnicos de RLS", () => {
    expect(userErrorMessage({ code: "42501", message: "new row violates row-level security policy" }, "No se pudo completar la cita.")).toBe(
      "No se pudo completar la cita.",
    );
  });
  it("traduce la caída de red", () => {
    expect(userErrorMessage({ message: "TypeError: Failed to fetch" }, "No se pudo.")).toMatch(/conexión/);
  });
});

describe("userErrorMessage (fetch)", () => {
  it("deja pasar el mensaje en español de la función", () => {
    expect(userErrorMessage(new Error("La consulta ya se realizó; no se puede cancelar."), "No se pudo cancelar.")).toBe(
      "La consulta ya se realizó; no se puede cancelar.",
    );
  });
  it("traduce Failed to fetch y respuestas que no son JSON", () => {
    expect(userErrorMessage(new TypeError("Failed to fetch"), "No se pudo cancelar.")).toMatch(/^No se pudo cancelar\. Verifica tu conexión/);
    expect(userErrorMessage(new SyntaxError("Unexpected token '<'"), "No se pudo cancelar.")).toBe("No se pudo cancelar.");
  });
});

describe("userErrorMessage (catálogos)", () => {
  it("un nombre repetido se explica en español", () => {
    expect(userErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "cities_name_key"' }, "No se pudo guardar.")).toBe(
      "Ya existe un registro con esos datos.",
    );
  });
});
