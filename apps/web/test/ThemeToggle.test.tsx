// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../src/components/ThemeToggle";
import { THEME_KEY } from "../src/lib/theme";

// El modo del celular: oscuro o claro.
function systemPrefersDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: dark && query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeToggle", () => {
  it("con el celular en claro ofrece el tema oscuro y guarda la elección", async () => {
    systemPrefersDark(false);
    render(<ThemeToggle />);

    await userEvent.click(await screen.findByRole("button", { name: "Cambiar a tema oscuro" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Cambiar a tema claro" })).toBeTruthy();
  });

  it("con el celular en oscuro ofrece el claro", async () => {
    systemPrefersDark(true);
    render(<ThemeToggle />);

    await userEvent.click(await screen.findByRole("button", { name: "Cambiar a tema claro" }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("respeta la elección guardada aunque el celular diga otra cosa", async () => {
    systemPrefersDark(true);
    localStorage.setItem(THEME_KEY, "light");
    document.documentElement.dataset.theme = "light";
    render(<ThemeToggle />);

    expect(await screen.findByRole("button", { name: "Cambiar a tema oscuro" })).toBeTruthy();
  });

  it("si el navegador no deja guardar, igual cambia el tema", async () => {
    systemPrefersDark(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("almacenamiento bloqueado");
    });
    render(<ThemeToggle />);

    await userEvent.click(await screen.findByRole("button", { name: "Cambiar a tema oscuro" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    vi.restoreAllMocks();
  });
});
