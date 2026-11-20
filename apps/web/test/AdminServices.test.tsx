// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminServices } from "../src/components/AdminServices";

const retiro = { id: "s1", name: "Retiro", priceCop: 15000, durationMinutes: 30, active: true };
const retoque = { id: "s2", name: "Retoque", priceCop: 60000, durationMinutes: 90, active: false };

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

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

const list =
  (...services: unknown[]) =>
  () =>
    json(200, { services });

function row(name: string) {
  const item = screen.getByText(name).closest("li");
  if (!item) throw new Error(`No está el servicio ${name}`);
  return within(item);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminServices: acceso", () => {
  it("sin sesión pide ingresar", async () => {
    mockApi({ "GET /api/admin/services": () => json(401, { error: "unauthorized" }) });
    render(<AdminServices />);

    expect(
      await screen.findByText("Ingresa con la cuenta de Caro para administrar los servicios."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ingresar" }).getAttribute("href")).toBe("/ingreso");
  });

  it("con una cuenta que no es admin avisa que es solo para Caro", async () => {
    mockApi({ "GET /api/admin/services": () => json(403, { error: "forbidden" }) });
    render(<AdminServices />);

    expect(await screen.findByText("Esta página es solo para Caro.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agregar servicio" })).toBeNull();
  });

  it("si falla la carga permite reintentar", async () => {
    let calls = 0;
    mockApi({
      "GET /api/admin/services": () =>
        ++calls === 1
          ? Promise.reject(new TypeError("Failed to fetch"))
          : json(200, { services: [retiro] }),
    });
    render(<AdminServices />);

    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Retiro")).toBeTruthy();
  });
});

describe("AdminServices: lista", () => {
  it("muestra todos los servicios, marcando los inactivos", async () => {
    mockApi({ "GET /api/admin/services": list(retiro, retoque) });
    render(<AdminServices />);

    expect(await screen.findByText("Retiro")).toBeTruthy();
    expect(row("Retiro").getByText("$15.000 · 30 min")).toBeTruthy();
    expect(row("Retiro").queryByText("Inactivo")).toBeNull();
    expect(row("Retoque").getByText("Inactivo")).toBeTruthy();
    expect(row("Retiro").getByRole("button", { name: "Desactivar" })).toBeTruthy();
    expect(row("Retoque").getByRole("button", { name: "Activar" })).toBeTruthy();
  });
});

describe("AdminServices: crear", () => {
  it("agrega un servicio y lo muestra al final", async () => {
    const created = {
      id: "s3",
      name: "Manicure",
      priceCop: 25000,
      durationMinutes: 45,
      active: true,
    };
    const sent = mockApi({
      "GET /api/admin/services": list(retiro),
      "POST /api/admin/services": () => json(201, { service: created }),
    });
    render(<AdminServices />);

    await userEvent.click(await screen.findByRole("button", { name: "Agregar servicio" }));
    await userEvent.type(screen.getByLabelText("Nombre"), "Manicure");
    await userEvent.type(screen.getByLabelText("Precio (pesos)"), "25000");
    await userEvent.type(screen.getByLabelText("Duración (minutos)"), "45");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Manicure")).toBeTruthy();
    expect(sent.at(-1)).toEqual({
      route: "POST /api/admin/services",
      body: { name: "Manicure", priceCop: 25000, durationMinutes: 45 },
    });
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Retiro"),
      expect.stringContaining("Manicure"),
    ]);
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
  });

  it("valida en el navegador antes de enviar", async () => {
    const sent = mockApi({ "GET /api/admin/services": list(retiro) });
    render(<AdminServices />);

    await userEvent.click(await screen.findByRole("button", { name: "Agregar servicio" }));
    await userEvent.type(screen.getByLabelText("Nombre"), "Manicure");
    await userEvent.type(screen.getByLabelText("Duración (minutos)"), "32");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("La duración debe ser múltiplo de 5 minutos.")).toBeTruthy();
    expect(
      screen.getByText("El precio debe ser un número entero entre 0 y 2.000.000."),
    ).toBeTruthy();
    expect(sent.map((call) => call.route)).toEqual(["GET /api/admin/services"]);
  });

  it("muestra el aviso de nombre repetido que devuelve la API", async () => {
    mockApi({
      "GET /api/admin/services": list(retiro),
      "POST /api/admin/services": () =>
        json(409, {
          error: "name_taken",
          fields: { name: "Ya existe un servicio con ese nombre." },
        }),
    });
    render(<AdminServices />);

    await userEvent.click(await screen.findByRole("button", { name: "Agregar servicio" }));
    await userEvent.type(screen.getByLabelText("Nombre"), "Retiro");
    await userEvent.type(screen.getByLabelText("Precio (pesos)"), "15000");
    await userEvent.type(screen.getByLabelText("Duración (minutos)"), "30");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Ya existe un servicio con ese nombre.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy();
  });

  it("cancelar cierra el formulario sin enviar", async () => {
    const sent = mockApi({ "GET /api/admin/services": list(retiro) });
    render(<AdminServices />);

    await userEvent.click(await screen.findByRole("button", { name: "Agregar servicio" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(sent).toHaveLength(1);
  });
});

describe("AdminServices: editar y activar", () => {
  it("edita un servicio con sus datos actuales precargados", async () => {
    const sent = mockApi({
      "GET /api/admin/services": list(retiro),
      "PATCH /api/admin/services/s1": () => json(200, { service: { ...retiro, priceCop: 18000 } }),
    });
    render(<AdminServices />);

    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Retiro");
    const price = screen.getByLabelText("Precio (pesos)");
    await userEvent.clear(price);
    await userEvent.type(price, "18000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("$18.000 · 30 min")).toBeTruthy();
    expect(sent.at(-1)).toEqual({
      route: "PATCH /api/admin/services/s1",
      body: { name: "Retiro", priceCop: 18000, durationMinutes: 30 },
    });
  });

  it("desactiva y vuelve a activar un servicio", async () => {
    const sent = mockApi({
      "GET /api/admin/services": list(retiro),
      "PATCH /api/admin/services/s1": (body) =>
        json(200, { service: { ...retiro, ...(body as object) } }),
    });
    render(<AdminServices />);

    await userEvent.click(await screen.findByRole("button", { name: "Desactivar" }));
    expect(await row("Retiro").findByText("Inactivo")).toBeTruthy();
    expect(sent.at(-1)?.body).toEqual({ active: false });

    await userEvent.click(row("Retiro").getByRole("button", { name: "Activar" }));
    expect(await row("Retiro").findByRole("button", { name: "Desactivar" })).toBeTruthy();
    expect(sent.at(-1)?.body).toEqual({ active: true });
  });

  it("si no se puede activar o desactivar, avisa y no cambia la lista", async () => {
    mockApi({
      "GET /api/admin/services": list(retiro),
      "PATCH /api/admin/services/s1": () => json(500, { error: "internal_error" }),
    });
    render(<AdminServices />);

    await userEvent.click(await screen.findByRole("button", { name: "Desactivar" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos guardar el cambio de Retiro. Inténtalo de nuevo.",
    );
    expect(row("Retiro").queryByText("Inactivo")).toBeNull();
  });
});
