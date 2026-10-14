import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Home, CalendarDays } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppShell from "./AppShell";

// QA 2026-10-14: en el celular la barra lateral (Sheet) seguía abierta después
// de elegir un módulo y tapaba la pantalla nueva.
const nav = [
  { title: "Inicio", url: "/admin/inicio", icon: Home },
  { title: "Agenda", url: "/admin/agenda", icon: CalendarDays },
];

function renderShell() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/admin/inicio"]}>
        <Routes>
          <Route element={<AppShell subtitle="Panel" nav={nav} settings={[]} profile={{ name: "", email: "a@b.mx", roleLabel: "Administrador" }} onSignOut={() => {}} />}>
            <Route path="/admin/inicio" element={<p>Pantalla inicio</p>} />
            <Route path="/admin/agenda" element={<p>Pantalla agenda</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("AppShell en el celular", () => {
  const width = window.innerWidth;
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  });
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  });

  it("cierra la barra lateral al navegar y tiene título accesible", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /Toggle Sidebar/i }));
    const dialog = await screen.findByRole("dialog", { name: "Menú" });
    fireEvent.click(dialog.querySelector('a[href="/admin/agenda"]')!);
    expect(await screen.findByText("Pantalla agenda")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("también se cierra al tocar el módulo en el que ya estás", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /Toggle Sidebar/i }));
    const dialog = await screen.findByRole("dialog", { name: "Menú" });
    fireEvent.click(dialog.querySelector('a[href="/admin/inicio"]')!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
