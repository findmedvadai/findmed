import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";

// Smoke test of the route table after code-splitting: a deep link to a lazy
// page must resolve through Suspense, and eager routes must keep working.
// Only public routes: no session, no network.
function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("App routes (code-splitting)", () => {
  it("loads a lazy public page from a deep link", async () => {
    renderAt("/privacidad");
    expect(
      await screen.findByRole("heading", { name: "Aviso de Privacidad" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });

  it("keeps the 404 page for unknown routes", async () => {
    renderAt("/no-existe");
    expect(await screen.findByText("404")).toBeInTheDocument();
  });
});
