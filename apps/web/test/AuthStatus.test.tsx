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

  it("después de borrar la cuenta avisa que se borró", async () => {
    window.history.replaceState(null, "", "/?cuenta=borrada");
    mockApi({ me: json(401, { error: "unauthorized" }) });
    render(<AuthStatus />);

    expect((await screen.findByRole("status")).textContent).toBe("Tu cuenta fue borrada.");
    expect(screen.getByRole("link", { name: "Crear cuenta" })).toBeTruthy();
    window.history.replaceState(null, "", "/");
  });

  it("sin ese aviso en la dirección no dice nada de borrar", async () => {
    mockApi({ me: json(401, { error: "unauthorized" }) });
    render(<AuthStatus />);
    await screen.findByRole("link", { name: "Crear cuenta" });
    expect(screen.queryByText("Tu cuenta fue borrada.")).toBeNull();
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

  it("a Caro (admin) le muestra el enlace al panel de servicios", async () => {
    mockApi({ me: json(200, { user: { ...ana, name: "Caro Restrepo", role: "admin" } }) });
    render(<AuthStatus />);

    expect(
      (await screen.findByRole("link", { name: "Administrar servicios" })).getAttribute("href"),
    ).toBe("/admin/servicios");
    expect(screen.getByRole("link", { name: "Ver agenda" }).getAttribute("href")).toBe(
      "/admin/agenda",
    );
    expect(screen.getByRole("link", { name: "Horario y reglas" }).getAttribute("href")).toBe(
      "/admin/horario",
    );
    expect(screen.getByRole("link", { name: "Clientas" }).getAttribute("href")).toBe(
      "/admin/clientas",
    );
  });

  it("a una clienta no le muestra el enlace al panel", async () => {
    mockApi({ me: json(200, { user: ana }) });
    render(<AuthStatus />);

    await screen.findByText("Ana María");
    expect(screen.queryByRole("link", { name: "Administrar servicios" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Ver agenda" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Horario y reglas" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Clientas" })).toBeNull();
  });

  it("con sesión muestra el enlace a Mis citas", async () => {
    mockApi({ me: json(200, { user: ana }) });
    render(<AuthStatus />);

    expect((await screen.findByRole("link", { name: "Mis citas" })).getAttribute("href")).toBe(
      "/mis-citas",
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
