import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { lazyWithReload, shouldReloadAfterChunkError } from "./lazy-with-reload";

describe("shouldReloadAfterChunkError", () => {
  it("reloads the first time", () => {
    expect(shouldReloadAfterChunkError(1_000_000, null)).toBe(true);
  });
  it("does not reload twice within 10 s (avoids a reload loop)", () => {
    expect(shouldReloadAfterChunkError(1_005_000, 1_000_000)).toBe(false);
  });
  it("reloads again once the window has passed", () => {
    expect(shouldReloadAfterChunkError(1_020_000, 1_000_000)).toBe(true);
  });
});

describe("lazyWithReload", () => {
  const reload = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    sessionStorage.clear();
    reload.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("renders the page when the chunk loads", async () => {
    const Page = lazyWithReload(async () => ({ default: () => <p>Página cargada</p> }));
    render(
      <Suspense fallback={<p>Cargando…</p>}>
        <Page />
      </Suspense>,
    );
    expect(await screen.findByText("Página cargada")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once when the chunk is gone after a deploy", async () => {
    const Page = lazyWithReload(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    render(
      <Suspense fallback={<p>Cargando…</p>}>
        <Page />
      </Suspense>,
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(sessionStorage.getItem("findmed:chunk-reload-at")).not.toBeNull();
  });
});
