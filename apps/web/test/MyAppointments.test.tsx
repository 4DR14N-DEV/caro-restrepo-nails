// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyAppointments } from "../src/components/MyAppointments";

const ana = { id: "u1", name: "Ana María", phone: "+573001234567", role: "client" };
const base = {
  services: ["Retiro"],
  durationMinutes: 30,
  totalPriceCop: 15000,
  canCancel: false,
  canReschedule: false,
};
const monday = {
  ...base,
  id: "a1",
  date: "2026-11-23",
  time: "09:00",
  services: ["Retiro", "Semipermanente manos"],
  durationMinutes: 90,
  totalPriceCop: 55000,
  state: "upcoming",
  canCancel: true,
  canReschedule: true,
};
const list = {
  upcoming: [monday],
  history: [
    { ...base, id: "a2", date: "2026-11-19", time: "13:00", state: "past" },
    { ...base, id: "a3", date: "2026-11-12", time: "10:00", state: "no_show" },
    { ...base, id: "a4", date: "2026-11-11", time: "10:00", state: "cancelled" },
    { ...base, id: "a5", date: "2026-11-10", time: "10:00", state: "completed" },
  ],
};

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

type Handler = (url: URL, init?: RequestInit) => Promise<Response>;

// Responde según el método y la ruta; cada ruta puede tener varias respuestas en orden y,
// después de la última, repite la última.
function mockApi(routes: Record<string, Handler | Handler[]>) {
  const used: Record<string, number> = {};
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const url = new URL(path, "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`Ruta sin respuesta en el test: ${key}`);
    const handlers = Array.isArray(route) ? route : [route];
    const handler = handlers[Math.min(used[key] ?? 0, handlers.length - 1)];
    used[key] = (used[key] ?? 0) + 1;
    if (!handler) throw new Error(`Ruta sin respuesta en el test: ${key}`);
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, pathname: string) =>
  fetchMock.mock.calls.filter(
    ([path, init]) =>
      (init?.method ?? "GET") === method && new URL(path, "http://localhost").pathname === pathname,
  );

const signedIn = (appointments: unknown = list) => ({
  "GET /api/auth/me": () => json(200, { user: ana }),
  "GET /api/appointments": () => json(200, appointments),
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MyAppointments", () => {
  it("sin sesión lleva a ingresar y vuelve a /mis-citas", async () => {
    mockApi({
      "GET /api/auth/me": () => json(401, { error: "unauthorized" }),
      "GET /api/appointments": () => json(401, { error: "unauthorized" }),
    });
    const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
    render(<MyAppointments />);

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/ingreso?next=%2Fmis-citas"));
  });

  it("muestra las próximas y el historial con día, servicios, duración, total y estado", async () => {
    mockApi(signedIn());
    render(<MyAppointments />);

    const upcoming = await screen.findByRole("region", { name: "Próximas" });
    const [next] = within(upcoming).getAllByRole("listitem");
    expect(next?.textContent).toContain("lunes 23 de noviembre a las 9:00 a. m.");
    expect(next?.textContent).toContain("Retiro, Semipermanente manos");
    expect(next?.textContent).toContain("1 h 30 min · $55.000");
    expect(next?.textContent).toContain("Confirmada");

    const history = screen.getByRole("region", { name: "Historial" });
    expect(
      within(history)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("jueves 19 de noviembre a la 1:00 p. m."),
      expect.stringContaining("No asistió"),
      expect.stringContaining("Cancelada"),
      expect.stringContaining("Completada"),
    ]);
    expect(within(history).getAllByRole("listitem")[0]?.textContent).toContain("Pasada");
    // El historial nunca ofrece cambios.
    expect(within(history).queryByRole("button")).toBeNull();
  });

  it("sin citas lo dice e invita a reservar", async () => {
    mockApi(signedIn({ upcoming: [], history: [] }));
    render(<MyAppointments />);

    expect(await screen.findByText("No tienes citas próximas.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reservar cita" }).getAttribute("href")).toBe(
      "/reservar",
    );
    expect(screen.getByText("Todavía no tienes citas pasadas.")).toBeTruthy();
  });

  it("al final está Mi cuenta, con Cambiar contraseña", async () => {
    mockApi(signedIn({ upcoming: [], history: [] }));
    render(<MyAppointments />);

    const account = await screen.findByRole("region", { name: "Mi cuenta" });
    expect(within(account).getByRole("button", { name: "Cambiar contraseña" })).toBeTruthy();
  });

  it("si falla la carga, avisa y permite reintentar", async () => {
    mockApi({
      "GET /api/auth/me": () => json(200, { user: ana }),
      "GET /api/appointments": [
        () => json(500, { error: "internal_error" }),
        () => json(200, list),
      ],
    });
    render(<MyAppointments />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos cargar tus citas. Inténtalo de nuevo en un momento.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("region", { name: "Próximas" })).toBeTruthy();
  });
});

describe("MyAppointments: qué se puede cambiar", () => {
  const card = async () => {
    const [first] = within(await screen.findByRole("region", { name: "Próximas" })).getAllByRole(
      "listitem",
    );
    if (!first) throw new Error("No hay citas próximas.");
    return first;
  };

  it("muestra Reprogramar y Cancelar solo cuando se permiten", async () => {
    mockApi(
      signedIn({
        upcoming: [
          monday,
          { ...monday, id: "a6", date: "2026-11-21", canReschedule: false },
          { ...monday, id: "a7", date: "2026-11-20", canCancel: false, canReschedule: false },
        ],
        history: [],
      }),
    );
    render(<MyAppointments />);

    const upcoming = await screen.findByRole("region", { name: "Próximas" });
    const [both, cancelOnly, none] = within(upcoming).getAllByRole("listitem");
    if (!both || !cancelOnly || !none) throw new Error("Faltan citas en la lista.");

    expect(within(both).getByRole("button", { name: "Reprogramar" })).toBeTruthy();
    expect(within(both).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(within(both).queryByText("Para cambios, escríbele a Caro.")).toBeNull();

    expect(within(cancelOnly).queryByRole("button", { name: "Reprogramar" })).toBeNull();
    expect(within(cancelOnly).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(within(cancelOnly).getByText("Para cambios, escríbele a Caro.")).toBeTruthy();

    expect(within(none).queryByRole("button")).toBeNull();
    expect(within(none).getByText("Para cambios, escríbele a Caro.")).toBeTruthy();
  });

  it("cancelar pide confirmación dentro de la página; «No» vuelve sin cancelar", async () => {
    const fetchMock = mockApi(signedIn());
    render(<MyAppointments />);

    await userEvent.click(within(await card()).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText("¿Seguro que quieres cancelar esta cita?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "No" }));

    expect(screen.queryByText("¿Seguro que quieres cancelar esta cita?")).toBeNull();
    expect(calls(fetchMock, "POST", "/api/appointments/a1/cancel")).toHaveLength(0);
  });

  it("al cancelar, lo confirma, ofrece avisar a Caro y recarga la lista", async () => {
    const fetchMock = mockApi({
      "GET /api/auth/me": () => json(200, { user: ana }),
      "GET /api/appointments": [
        () => json(200, list),
        () => json(200, { upcoming: [], history: [{ ...monday, state: "cancelled" }] }),
      ],
      "POST /api/appointments/a1/cancel": () =>
        json(200, {
          appointment: { ...monday, state: "cancelled", canCancel: false, canReschedule: false },
          caroWhatsapp: "+573007445676",
        }),
    });
    render(<MyAppointments />);

    await userEvent.click(within(await card()).getByRole("button", { name: "Cancelar" }));
    await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar" }));

    const done = await screen.findByRole("status");
    expect(done.textContent).toContain("Tu cita quedó cancelada.");
    expect(
      within(done).getByRole("link", { name: "Avisar a Caro por WhatsApp" }).getAttribute("href"),
    ).toBe(
      "https://wa.me/573007445676?text=" +
        encodeURIComponent(
          "Hola Caro, soy Ana María. Cancelé mi cita de Retiro y Semipermanente manos del lunes 23 de noviembre a las 9:00 a. m.",
        ),
    );
    await vi.waitFor(() => expect(calls(fetchMock, "GET", "/api/appointments")).toHaveLength(2));
    expect(await screen.findByText("No tienes citas próximas.")).toBeTruthy();
  });

  it("si ya no se puede cancelar, lo avisa y recarga la lista", async () => {
    const message = "Ya no se puede cancelar esta cita. Escríbele a Caro por WhatsApp.";
    const fetchMock = mockApi({
      ...signedIn(),
      "POST /api/appointments/a1/cancel": () =>
        json(409, { error: "cancel_too_late", fields: { form: message } }),
    });
    render(<MyAppointments />);

    await userEvent.click(within(await card()).getByRole("button", { name: "Cancelar" }));
    await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar" }));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    await vi.waitFor(() => expect(calls(fetchMock, "GET", "/api/appointments")).toHaveLength(2));
  });

  it("reprogramar: día → hora → confirmar, y ofrece avisar a Caro", async () => {
    const moved = { ...monday, date: "2026-11-24", time: "15:00" };
    const fetchMock = mockApi({
      ...signedIn(),
      "GET /api/booking/days": () => json(200, { days: ["2026-11-23", "2026-11-24"] }),
      "GET /api/appointments/a1/times": () => json(200, { times: ["10:00", "15:00"] }),
      "PATCH /api/appointments/a1": () =>
        json(200, { appointment: moved, caroWhatsapp: "+573007445676" }),
    });
    render(<MyAppointments />);

    await userEvent.click(within(await card()).getByRole("button", { name: "Reprogramar" }));
    await userEvent.click(await screen.findByRole("button", { name: "mar 24 nov" }));
    const [timesCall] = calls(fetchMock, "GET", "/api/appointments/a1/times");
    expect(new URL(String(timesCall?.[0]), "http://localhost").searchParams.get("date")).toBe(
      "2026-11-24",
    );
    await userEvent.click(await screen.findByRole("button", { name: "3:00 p. m." }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cambio" }));

    const [patch] = calls(fetchMock, "PATCH", "/api/appointments/a1");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ date: "2026-11-24", time: "15:00" });
    const done = await screen.findByRole("status");
    expect(done.textContent).toContain(
      "Tu cita quedó para el martes 24 de noviembre a las 3:00 p. m.",
    );
    expect(
      within(done).getByRole("link", { name: "Avisar a Caro por WhatsApp" }).getAttribute("href"),
    ).toBe(
      "https://wa.me/573007445676?text=" +
        encodeURIComponent(
          "Hola Caro, soy Ana María. Moví mi cita de Retiro y Semipermanente manos del lunes 23 de noviembre a las 9:00 a. m. al martes 24 de noviembre a las 3:00 p. m.",
        ),
    );
  });

  it("si la hora nueva ya no está, lo avisa y recarga las horas", async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      "GET /api/booking/days": () => json(200, { days: ["2026-11-24"] }),
      "GET /api/appointments/a1/times": [
        () => json(200, { times: ["10:00", "15:00"] }),
        () => json(200, { times: ["10:00"] }),
      ],
      "PATCH /api/appointments/a1": () =>
        json(409, {
          error: "slot_taken",
          fields: { time: "Esa hora ya no está disponible. Elige otra." },
        }),
    });
    render(<MyAppointments />);

    await userEvent.click(within(await card()).getByRole("button", { name: "Reprogramar" }));
    await userEvent.click(await screen.findByRole("button", { name: "mar 24 nov" }));
    await userEvent.click(await screen.findByRole("button", { name: "3:00 p. m." }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cambio" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Esa hora ya no está disponible. Elige otra.",
    );
    await vi.waitFor(() =>
      expect(calls(fetchMock, "GET", "/api/appointments/a1/times")).toHaveLength(2),
    );
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "3:00 p. m." })).toBeNull());
  });
});
