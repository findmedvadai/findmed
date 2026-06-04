import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Privacidad from "./Privacidad";
import Terminos from "./Terminos";

function renderAt(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("Página /privacidad", () => {
  it("renderea el encabezado principal y la fecha", () => {
    renderAt(<Privacidad />);
    expect(
      screen.getByRole("heading", { level: 1, name: /Aviso de Privacidad/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Fecha de última actualización/i)).toBeInTheDocument();
  });

  it("renderea el bloque de Limited Use disclosure en inglés (requerido por Google)", () => {
    const { container } = renderAt(<Privacidad />);
    // El texto se reparte entre nodos (el nombre de la política va en negrita
    // dentro de la cursiva), por eso se valida sobre el textContent agregado.
    const text = container.textContent ?? "";
    expect(text).toContain(
      "will adhere to the Google API Services User Data Policy, including the Limited Use requirements",
    );
    // Y se confirma que el nombre de la política se rendereó en negrita (faithful).
    const strongs = Array.from(container.querySelectorAll("strong"));
    expect(
      strongs.some((el) => el.textContent === "Google API Services User Data Policy"),
    ).toBe(true);
  });

  it("renderea la tabla de proveedores tecnológicos con sus filas", () => {
    renderAt(<Privacidad />);
    const table = screen.getByRole("table");
    expect(within(table).getByText(/Supabase Inc\./)).toBeInTheDocument();
    expect(within(table).getByText(/Vercel Inc\./)).toBeInTheDocument();
    expect(within(table).getByText(/Google LLC/)).toBeInTheDocument();
    expect(within(table).getByText(/Microsoft Corporation/)).toBeInTheDocument();
    expect(within(table).getByText(/Whaapy/)).toBeInTheDocument();
    expect(within(table).getByText(/Meta Platforms, Inc\./)).toBeInTheDocument();
  });

  it("expone los links del footer a las rutas legales", () => {
    renderAt(<Privacidad />);
    expect(screen.getByRole("link", { name: "Aviso de Privacidad" })).toHaveAttribute(
      "href",
      "/privacidad",
    );
    expect(screen.getByRole("link", { name: "Términos y Condiciones" })).toHaveAttribute(
      "href",
      "/terminos",
    );
  });
});

describe("Página /terminos", () => {
  it("renderea el encabezado principal y secciones clave", () => {
    renderAt(<Terminos />);
    expect(
      screen.getByRole("heading", { level: 1, name: /Términos y Condiciones/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Limitación de responsabilidad/i }),
    ).toBeInTheDocument();
  });
});
