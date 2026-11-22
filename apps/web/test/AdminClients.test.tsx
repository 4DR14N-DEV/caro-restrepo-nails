// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminClients } from "../src/components/AdminClients";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

type Handler = (body: unknown) => Promise<Response>;

// Responde según método y ruta; guarda cada pedido para revisarlo.
function mockApi(handlers: Record<string, Handler>) {
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init: RequestInit) => {
      const route = `${init.method} ${path}`;
      sent.push(route);
      const handler = handlers[route];
      if (!handler) throw new Error(`Ruta no esperada: ${route}`);
      return handler(init.body ? JSON.parse(String(init.body)) : undefined);
    }),
  );
  return sent;
}

const ana = {
  id: "c1",
  name: "Ana María",
  phone: "+573001234567",
  registeredOn: "2026-10-05",
  upcoming: 2,
};
const marta = {
  id: "c2",
  name: "Marta",
  phone: "+573105551234",
  registeredOn: "2026-11-20",
  upcoming: 1,
};
const luisa = {
  id: "c3",
  name: "Luisa",
  phone: "+573009876543",
  registeredOn: "2026-11-21",
  upcoming: 0,
};
const loaded = () => json(200, { clients: [ana, marta, luisa] });

const row = (name: string) => {
  const item = screen.getByText(name).closest("li");
  if (!item) throw new Error(`No está la clienta ${name}`);
  return within(item);
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminClients: acceso", () => {
  it("sin sesión pide ingresar y vuelve a clientas", async () => {
    mockApi({ "GET /api/admin/clients/list": () => json(401, { error: "unauthorized" }) });
    render(<AdminClients />);

    expect(
      await screen.findByText("Ingresa con la cuenta de Caro para ver las clientas."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ingresar" }).getAttribute("href")).toBe(
      "/ingreso?next=%2Fadmin%2Fclientas",
    );
  });

  it("con una cuenta que no es admin avisa que es solo para Caro", async () => {
    mockApi({ "GET /api/admin/clients/list": () => json(403, { error: "forbidden" }) });
    render(<AdminClients />);
    expect(await screen.findByText("Esta página es solo para Caro.")).toBeTruthy();
  });

  it("si falla la carga permite reintentar", async () => {
    let calls = 0;
    mockApi({
      "GET /api/admin/clients/list": () => (++calls === 1 ? json(500, { error: "x" }) : loaded()),
    });
    render(<AdminClients />);
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Ana María")).toBeTruthy();
  });
});

describe("AdminClients: lista", () => {
  it("muestra cada clienta con celular, registro y citas próximas", async () => {
    mockApi({ "GET /api/admin/clients/list": loaded });
    render(<AdminClients />);

    await screen.findByText("Ana María");
    expect(screen.getByText("3 clientas")).toBeTruthy();
    expect(row("Ana María").getByText("+573001234567")).toBeTruthy();
    expect(row("Ana María").getByText("Registrada el lunes 5 de octubre de 2026")).toBeTruthy();
    expect(row("Ana María").getByText("2 citas próximas")).toBeTruthy();
    expect(row("Marta").getByText("1 cita próxima")).toBeTruthy();
    expect(row("Luisa").getByText("Sin citas próximas")).toBeTruthy();
  });

  it("filtra por nombre (sin mayúsculas ni tildes) o por celular", async () => {
    mockApi({ "GET /api/admin/clients/list": loaded });
    render(<AdminClients />);
    await screen.findByText("Ana María");
    const filter = screen.getByLabelText("Buscar por nombre o celular");
    const names = () =>
      screen.getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent);

    await userEvent.type(filter, "maria");
    expect(names()).toEqual(["Ana María"]);
    await userEvent.clear(filter);
    await userEvent.type(filter, "310 555");
    expect(names()).toEqual(["Marta"]);
    await userEvent.clear(filter);
    await userEvent.type(filter, "zz");
    expect(screen.getByText("No hay clientas con ese nombre o celular.")).toBeTruthy();
  });

  it("sin clientas lo dice", async () => {
    mockApi({ "GET /api/admin/clients/list": () => json(200, { clients: [] }) });
    render(<AdminClients />);
    expect(await screen.findByText("Todavía no hay clientas registradas.")).toBeTruthy();
  });
});

describe("AdminClients: restablecer contraseña", () => {
  it("pide confirmar; al generar muestra la clave una vez con el botón de WhatsApp", async () => {
    const sent = mockApi({
      "GET /api/admin/clients/list": loaded,
      "POST /api/admin/clients/c1/password": () =>
        json(200, {
          client: { id: "c1", name: "Ana María", phone: "+573001234567" },
          password: "k7m2q9rt4x",
        }),
    });
    render(<AdminClients />);
    await screen.findByText("Ana María");

    await userEvent.click(row("Ana María").getByRole("button", { name: "Restablecer contraseña" }));
    expect(
      row("Ana María").getByText(
        "¿Generar una contraseña nueva para Ana María? La actual deja de servir.",
      ),
    ).toBeTruthy();
    await userEvent.click(row("Ana María").getByRole("button", { name: "Cancelar" }));
    expect(sent).toEqual(["GET /api/admin/clients/list"]);

    await userEvent.click(row("Ana María").getByRole("button", { name: "Restablecer contraseña" }));
    await userEvent.click(row("Ana María").getByRole("button", { name: "Generar contraseña" }));

    const done = await screen.findByRole("status");
    expect(within(done).getByText("k7m2q9rt4x")).toBeTruthy();
    expect(within(done).getByText("Solo se muestra esta vez.")).toBeTruthy();
    expect(
      within(done).getByRole("link", { name: "Enviar por WhatsApp" }).getAttribute("href"),
    ).toBe(
      `https://wa.me/573001234567?text=${encodeURIComponent(
        'Hola Ana María, soy Caro. Tu nueva contraseña es k7m2q9rt4x. Ingresa con tu celular y esta contraseña; puedes cambiarla en "Mis citas".',
      )}`,
    );
  });

  it("si la clienta ya no está, lo dice", async () => {
    mockApi({
      "GET /api/admin/clients/list": loaded,
      "POST /api/admin/clients/c2/password": () => json(404, { error: "not_found" }),
    });
    render(<AdminClients />);
    await screen.findByText("Marta");
    await userEvent.click(row("Marta").getByRole("button", { name: "Restablecer contraseña" }));
    await userEvent.click(row("Marta").getByRole("button", { name: "Generar contraseña" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Esa clienta ya no está disponible.",
    );
  });

  it("si la sesión venció, pide ingresar", async () => {
    mockApi({
      "GET /api/admin/clients/list": loaded,
      "POST /api/admin/clients/c2/password": () => json(401, { error: "unauthorized" }),
    });
    render(<AdminClients />);
    await screen.findByText("Marta");
    await userEvent.click(row("Marta").getByRole("button", { name: "Restablecer contraseña" }));
    await userEvent.click(row("Marta").getByRole("button", { name: "Generar contraseña" }));

    expect(
      await screen.findByText("Ingresa con la cuenta de Caro para ver las clientas."),
    ).toBeTruthy();
  });
});
