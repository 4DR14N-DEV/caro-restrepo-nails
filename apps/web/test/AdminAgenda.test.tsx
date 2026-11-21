// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminAgenda } from "../src/components/AdminAgenda";

const TODAY = "2026-11-23"; // lunes

const item = (values: Record<string, unknown>) => ({
  id: "a1",
  date: TODAY,
  time: "09:00",
  services: ["Retiro", "Semipermanente manos"],
  durationMinutes: 90,
  totalPriceCop: 55000,
  status: "scheduled",
  client: { name: "Ana María", phone: "+573001234567" },
  canMark: true,
  canCancel: true,
  ...values,
});

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

const agendaQueries = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .map(([path]) => new URL(path, "http://localhost"))
    .filter((url) => url.pathname === "/api/admin/agenda")
    .map((url) => Object.fromEntries(url.searchParams));

// El elemento `index` de una lista; falla con un mensaje claro si no existe.
function nth<T>(items: T[], index: number): T {
  const found = items[index];
  if (!found) throw new Error(`Falta el elemento ${index} de la lista.`);
  return found;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AdminAgenda: acceso", () => {
  it("sin sesión pide ingresar con la cuenta de Caro y vuelve a la agenda", async () => {
    mockApi({ "GET /api/admin/agenda": () => json(401, { error: "unauthorized" }) });
    render(<AdminAgenda today={TODAY} />);

    expect(
      await screen.findByText("Ingresa con la cuenta de Caro para ver la agenda."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ingresar" }).getAttribute("href")).toBe(
      "/ingreso?next=%2Fadmin%2Fagenda",
    );
  });

  it("a una clienta le dice que la página es solo para Caro", async () => {
    mockApi({ "GET /api/admin/agenda": () => json(403, { error: "forbidden" }) });
    render(<AdminAgenda today={TODAY} />);

    expect(await screen.findByText("Esta página es solo para Caro.")).toBeTruthy();
  });
});

describe("AdminAgenda: día", () => {
  it("muestra hoy por defecto con hora, clienta, servicios, duración, total y estado", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/agenda": () =>
        json(200, {
          appointments: [
            item({}),
            item({ id: "a2", time: "15:00", status: "completed", canCancel: false }),
          ],
        }),
    });
    render(<AdminAgenda today={TODAY} />);

    expect(await screen.findByRole("heading", { name: "lunes 23 de noviembre" })).toBeTruthy();
    expect(agendaQueries(fetchMock)[0]).toEqual({ from: TODAY, to: TODAY });
    const [first, second] = screen.getAllByRole("listitem");
    expect(first?.textContent).toContain("9:00 a. m.");
    expect(first?.textContent).toContain("Ana María");
    expect(
      within(nth(screen.getAllByRole("listitem"), 0))
        .getByRole("link", { name: "+573001234567" })
        .getAttribute("href"),
    ).toBe("tel:+573001234567");
    expect(first?.textContent).toContain("Retiro, Semipermanente manos");
    expect(first?.textContent).toContain("1 h 30 min · $55.000");
    expect(first?.textContent).toContain("Agendada");
    expect(second?.textContent).toContain("Completada");
  });

  it("cada cita agendada tiene el recordatorio por WhatsApp ya escrito", async () => {
    mockApi({
      "GET /api/admin/agenda": () =>
        json(200, {
          appointments: [
            item({}),
            item({ id: "a2", status: "completed", canCancel: false }),
            item({ id: "a3", client: { name: "Cuenta borrada", phone: null } }),
          ],
        }),
    });
    render(<AdminAgenda today={TODAY} />);

    const [scheduled, done, anonymous] = await screen.findAllByRole("listitem");
    expect(
      within(nth([scheduled], 0))
        .getByRole("link", { name: "Recordar por WhatsApp" })
        .getAttribute("href"),
    ).toBe(
      "https://wa.me/573001234567?text=" +
        encodeURIComponent(
          "Hola Ana María, te recuerdo tu cita de Retiro y Semipermanente manos el lunes 23 de noviembre a las 9:00 a. m. ¡Te espero!",
        ),
    );
    expect(
      within(nth([done], 0)).queryByRole("link", { name: "Recordar por WhatsApp" }),
    ).toBeNull();
    expect(
      within(nth([anonymous], 0)).queryByRole("link", { name: "Recordar por WhatsApp" }),
    ).toBeNull();
  });

  it("pasa al día anterior y al siguiente", async () => {
    const fetchMock = mockApi({ "GET /api/admin/agenda": () => json(200, { appointments: [] }) });
    render(<AdminAgenda today={TODAY} />);

    expect(await screen.findByText("No hay citas este día.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Día siguiente" }));
    expect(await screen.findByRole("heading", { name: "martes 24 de noviembre" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Día anterior" }));
    await userEvent.click(screen.getByRole("button", { name: "Día anterior" }));
    expect(await screen.findByRole("heading", { name: "domingo 22 de noviembre" })).toBeTruthy();
    expect(agendaQueries(fetchMock).map((q) => q.from)).toEqual([
      TODAY,
      "2026-11-24",
      TODAY,
      "2026-11-22",
    ]);
  });

  it("«Mostrar canceladas» las pide a la API", async () => {
    const fetchMock = mockApi({ "GET /api/admin/agenda": () => json(200, { appointments: [] }) });
    render(<AdminAgenda today={TODAY} />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Mostrar canceladas" }));
    await vi.waitFor(() =>
      expect(agendaQueries(fetchMock).at(-1)).toEqual({ from: TODAY, to: TODAY, cancelled: "1" }),
    );
  });
});

describe("AdminAgenda: marcar estado", () => {
  it("marca completada y muestra el estado nuevo", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/agenda": () => json(200, { appointments: [item({})] }),
      "PATCH /api/admin/appointments/a1/status": () =>
        json(200, { appointment: item({ status: "completed", canCancel: false }) }),
    });
    render(<AdminAgenda today={TODAY} />);

    const card = nth(await screen.findAllByRole("listitem"), 0);
    await userEvent.click(within(card).getByRole("button", { name: "Completada" }));

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ status: "completed" });
    await vi.waitFor(() =>
      expect(screen.getAllByRole("listitem")[0]?.textContent).toContain("Completada"),
    );
    expect(
      within(nth(screen.getAllByRole("listitem"), 0)).queryByRole("button", { name: "Cancelar" }),
    ).toBeNull();
  });

  it("si todavía no empezó, no ofrece marcarla", async () => {
    mockApi({
      "GET /api/admin/agenda": () => json(200, { appointments: [item({ canMark: false })] }),
    });
    render(<AdminAgenda today={TODAY} />);

    const card = nth(await screen.findAllByRole("listitem"), 0);
    expect(within(card).queryByRole("button", { name: "Completada" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "No asistió" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });

  it("cancelar pide confirmación y después ofrece avisar a la clienta", async () => {
    mockApi({
      "GET /api/admin/agenda": () => json(200, { appointments: [item({})] }),
      "PATCH /api/admin/appointments/a1/status": () =>
        json(200, { appointment: item({ status: "cancelled", canMark: false, canCancel: false }) }),
    });
    render(<AdminAgenda today={TODAY} />);

    const card = nth(await screen.findAllByRole("listitem"), 0);
    await userEvent.click(within(card).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText("¿Seguro que quieres cancelar esta cita?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar" }));

    const done = await screen.findByRole("status");
    expect(done.textContent).toContain("Cita cancelada.");
    expect(
      within(done)
        .getByRole("link", { name: "Avisar a Ana María por WhatsApp" })
        .getAttribute("href"),
    ).toBe(
      "https://wa.me/573001234567?text=" +
        encodeURIComponent(
          "Hola Ana María, soy Caro. Tuve que cancelar tu cita de Retiro y Semipermanente manos del lunes 23 de noviembre a las 9:00 a. m. Escríbeme para buscar otro horario.",
        ),
    );
  });

  it("si la API no deja el cambio, avisa y recarga el día", async () => {
    const message = "Solo puedes marcarla cuando la cita ya empezó.";
    const fetchMock = mockApi({
      "GET /api/admin/agenda": () => json(200, { appointments: [item({})] }),
      "PATCH /api/admin/appointments/a1/status": () =>
        json(409, { error: "status_not_allowed", fields: { form: message } }),
    });
    render(<AdminAgenda today={TODAY} />);

    const card = nth(await screen.findAllByRole("listitem"), 0);
    await userEvent.click(within(card).getByRole("button", { name: "No asistió" }));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    await vi.waitFor(() => expect(agendaQueries(fetchMock)).toHaveLength(2));
  });
});

describe("AdminAgenda: semana y mes", () => {
  it("la semana lista de lunes a sábado y tocar un día abre su vista", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/agenda": () =>
        json(200, {
          appointments: [
            item({}),
            item({
              id: "a2",
              date: "2026-11-25",
              time: "14:00",
              client: { name: "Luisa", phone: "+573009876543" },
            }),
          ],
        }),
    });
    render(<AdminAgenda today="2026-11-25" />);

    await userEvent.click(await screen.findByRole("button", { name: "Semana" }));
    await vi.waitFor(() =>
      expect(agendaQueries(fetchMock).at(-1)).toEqual({ from: "2026-11-23", to: "2026-11-28" }),
    );
    const days = await screen.findAllByRole("region");
    expect(days.map((day) => within(day).getByRole("heading").textContent)).toEqual([
      "lunes 23 de noviembre",
      "martes 24 de noviembre",
      "miércoles 25 de noviembre",
      "jueves 26 de noviembre",
      "viernes 27 de noviembre",
      "sábado 28 de noviembre",
    ]);
    expect(days[0]?.textContent).toContain("9:00 a. m. · Ana María · Retiro, Semipermanente manos");
    expect(days[1]?.textContent).toContain("Sin citas");

    await userEvent.click(within(nth(days, 2)).getByRole("button", { name: "Ver día" }));
    expect(await screen.findByRole("heading", { name: "miércoles 25 de noviembre" })).toBeTruthy();
    await vi.waitFor(() =>
      expect(agendaQueries(fetchMock).at(-1)).toEqual({ from: "2026-11-25", to: "2026-11-25" }),
    );
  });

  it("el mes cuenta las citas agendadas de cada día y tocar un día lo abre", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/agenda": () =>
        json(200, {
          appointments: [
            item({}),
            item({ id: "a2", time: "11:00" }),
            item({ id: "a3", time: "15:00", status: "completed", canCancel: false }),
            item({ id: "a4", date: "2026-11-24" }),
          ],
        }),
    });
    render(<AdminAgenda today={TODAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Mes" }));
    await vi.waitFor(() =>
      expect(agendaQueries(fetchMock).at(-1)).toEqual({ from: "2026-10-26", to: "2026-12-06" }),
    );
    expect(await screen.findByRole("heading", { name: "noviembre de 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "lunes 23 de noviembre: 2 citas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "martes 24 de noviembre: 1 cita" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "martes 24 de noviembre: 1 cita" }));
    expect(await screen.findByRole("heading", { name: "martes 24 de noviembre" })).toBeTruthy();
  });
});

describe("AdminAgenda: volver a la misma fecha", () => {
  it.each([["Hoy"], ["Día"]])(
    'tocar "%s" estando en hoy no deja la agenda cargando',
    async (name) => {
      const fetchMock = mockApi({ "GET /api/admin/agenda": () => json(200, { appointments: [] }) });
      render(<AdminAgenda today={TODAY} />);
      await screen.findByText("No hay citas este día.");

      await userEvent.click(screen.getByRole("button", { name }));

      await waitFor(() => expect(screen.queryByText("Cargando la agenda…")).toBeNull());
      expect(screen.getByText("No hay citas este día.")).toBeTruthy();
      expect(fetchMock).toHaveBeenCalled();
    },
  );
});
