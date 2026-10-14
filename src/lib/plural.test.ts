import { describe, expect, it } from "vitest";
import { plural } from "./plural";

describe("plural", () => {
  it("usa el singular solo con 1", () => {
    expect(plural(1, "desconectado", "desconectados")).toBe("1 desconectado");
    expect(plural(0, "desconectado", "desconectados")).toBe("0 desconectados");
    expect(plural(3, "error", "errores")).toBe("3 errores");
  });
});
