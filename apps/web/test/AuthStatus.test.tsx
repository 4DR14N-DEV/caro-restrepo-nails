// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStatus } from "../src/components/AuthStatus";

const ana = { id: "u1", name: "Ana María", phone: "+573001234567", role: "client" };

// Responde según la ruta: la sesión actual y el resultado de salir.
function mockApi({ me, logout }: { me: Response; logout?: Response }) {
  const fetchMock = vi.fn((path: string) =>
    Promise.resolve(
      path === "/api/auth/me" ? me.clone() : (logout ?? new Response(null, { status: 204 })),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuthStatus", () => {
  it("sin sesión muestra los enlaces para crear cuenta e ingresar", async () => {
    mockApi({ me: json(401, { error: "unauthorized" }) });
    render(<AuthStatus />);

    expect(await screen.findByRole("link", { name: "Crear cuenta" })).toHaveProperty(
      "href",
      expect.stringContaining("/registro"),
    );
    expect(screen.getByRole("link", { name: "Ingresar" })).toBeTruthy();
  });

  it("con sesión saluda y, al salir bien, vuelve a mostrar los enlaces", async () => {
    const fetchMock = mockApi({ me: json(200, { user: ana }) });
    render(<AuthStatus />);

    expect(await screen.findByText("Ana María")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Salir" }));

    expect(await screen.findByRole("link", { name: "Ingresar" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("si la salida falla, avisa y mantiene la sesión a la vista", async () => {
    mockApi({ me: json(200, { user: ana }), logout: json(500, { error: "internal_error" }) });
    render(<AuthStatus />);

    await userEvent.click(await screen.findByRole("button", { name: "Salir" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos cerrar tu sesión. Inténtalo de nuevo.",
    );
    expect(screen.getByText("Ana María")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Ingresar" })).toBeNull();
  });
});
