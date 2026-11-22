// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyAccount } from "../src/components/MyAccount";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));

type Handler = (body: unknown) => Promise<Response>;

// Responde según método y ruta; guarda cada cuerpo enviado para revisarlo.
function mockApi(handlers: Record<string, Handler>) {
  const sent: { route: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit) => {
      const route = `${init.method} ${path}`;
      const body: unknown = init.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ route, body });
      const handler = handlers[route];
      if (!handler) throw new Error(`Ruta no esperada: ${route}`);
      return handler(body);
    }),
  );
  return sent;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openChange() {
  render(<MyAccount />);
  await userEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
}

async function fill(current: string, next: string, repeat = next) {
  if (current) await userEvent.type(screen.getByLabelText("Contraseña actual"), current);
  if (next) await userEvent.type(screen.getByLabelText("Contraseña nueva"), next);
  if (repeat) await userEvent.type(screen.getByLabelText("Repite la contraseña nueva"), repeat);
  await userEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));
}

describe("MyAccount: cambiar contraseña", () => {
  it("está en la sección Mi cuenta y el formulario se abre y se cierra", async () => {
    mockApi({});
    render(<MyAccount />);
    const section = screen.getByRole("region", { name: "Mi cuenta" });
    await userEvent.click(within(section).getByRole("button", { name: "Cambiar contraseña" }));
    expect(screen.getByLabelText("Contraseña actual")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Contraseña actual")).toBeNull();
  });

  it("envía la actual y la nueva; al terminar avisa y cierra el formulario", async () => {
    const sent = mockApi({ "POST /api/auth/password": () => json(204, null) });
    await openChange();
    await fill("clave-actual-1", "nueva-clave-2");

    expect(
      await screen.findByText("Tu contraseña cambió. Cerramos tus otras sesiones abiertas."),
    ).toBeTruthy();
    expect(sent).toEqual([
      {
        route: "POST /api/auth/password",
        body: { currentPassword: "clave-actual-1", newPassword: "nueva-clave-2" },
      },
    ]);
    expect(screen.queryByLabelText("Contraseña actual")).toBeNull();
  });

  it("revisa antes de enviar: la nueva con al menos 8 caracteres y repetida igual", async () => {
    const sent = mockApi({});
    await openChange();
    await fill("", "corta", "corto");

    expect(screen.getByText("Escribe tu contraseña actual.")).toBeTruthy();
    expect(screen.getByText("La contraseña debe tener al menos 8 caracteres.")).toBeTruthy();
    expect(screen.getByText("Las contraseñas no coinciden.")).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it("si la actual no es correcta, lo dice junto al campo", async () => {
    mockApi({
      "POST /api/auth/password": () =>
        json(400, {
          error: "wrong_password",
          fields: { currentPassword: "La contraseña actual no es correcta." },
        }),
    });
    await openChange();
    await fill("mala-clave", "nueva-clave-2");

    expect(await screen.findByText("La contraseña actual no es correcta.")).toBeTruthy();
    expect(screen.getByLabelText("Contraseña actual")).toBeTruthy();
  });

  it("con demasiados intentos dice cuánto esperar", async () => {
    mockApi({
      "POST /api/auth/password": () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "too_many_attempts" }), {
            status: 429,
            headers: { "Retry-After": "900" },
          }),
        ),
    });
    await openChange();
    await fill("mala-clave", "nueva-clave-2");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Demasiados intentos. Vuelve a intentarlo en 15 minutos.",
    );
  });

  it("si la sesión venció, lleva a ingresar y vuelve a Mis citas", async () => {
    mockApi({ "POST /api/auth/password": () => json(401, { error: "unauthorized" }) });
    const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
    await openChange();
    await fill("clave-actual-1", "nueva-clave-2");

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/ingreso?next=%2Fmis-citas"));
  });
});
