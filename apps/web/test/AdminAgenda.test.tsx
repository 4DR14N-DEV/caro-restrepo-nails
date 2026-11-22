// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const exception = (values: Record<string, unknown>) => ({
  id: "e1",
  date: TODAY,
  kind: "break",
  from: "13:00",
  to: "14:00",
  allDay: false,
  reason: null,
  ...values,
});

const postBody = (fetchMock: ReturnType<typeof mockApi>) => {
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  return JSON.parse(String(post?.[1]?.body));
};

describe("AdminAgenda: horario del día", () => {
  it("lista lo cargado con su tipo, franja y motivo, y «Quitar» lo borra", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/agenda": [
        () =>
          json(200, {
            appointments: [],
            exceptions: [
              exception({ reason: "Almuerzo" }),
              exception({ id: "e2", kind: "extra_open", from: "08:00", to: "09:00" }),
            ],
          }),
        () =>
          json(200, {
            appointments: [],
            exceptions: [exception({ id: "e2", kind: "extra_open", from: "08:00", to: "09:00" })],
          }),
      ],
      "DELETE /api/admin/exceptions/e1": () => Promise.resolve(new Response(null, { status: 204 })),
    });
    render(<AdminAgenda today={TODAY} />);

    const section = await screen.findByRole("region", { name: "Horario del día" });
    const [pause, early] = within(section).getAllByRole("listitem");
    expect(pause?.textContent).toContain("Descanso 1:00–2:00 p. m. · Almuerzo");
    expect(early?.textContent).toContain("Abre más temprano 8:00–9:00 a. m.");

    await userEvent.click(within(nth([pause], 0)).getByRole("button", { name: "Quitar" }));

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
    await vi.waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Horario del día" })).getAllByRole("listitem"),
      ).toHaveLength(1),
    );
  });

  it("«Quitar» se deshabilita mientras borra: un doble toque manda un solo pedido", async () => {
    let finish: (response: Response) => void = () => {};
    const fetchMock = mockApi({
      "GET /api/admin/agenda": () => json(200, { appointments: [], exceptions: [exception({})] }),
      "DELETE /api/admin/exceptions/e1": () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    render(<AdminAgenda today={TODAY} />);

    const section = await screen.findByRole("region", { name: "Horario del día" });
    const quitar = within(section).getByRole("button", { name: "Quitar" });
    await userEvent.click(quitar);
    await userEvent.click(quitar);

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect((quitar as HTMLButtonElement).disabled).toBe(true);
    finish(new Response(null, { status: 204 }));
  });

  it("agrega un descanso con su franja y motivo", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/agenda": [
        () => json(200, { appointments: [], exceptions: [] }),
        () => json(200, { appointments: [], exceptions: [exception({ reason: "Almuerzo" })] }),
      ],
      "POST /api/admin/exceptions": () =>
        json(201, { exception: exception({ reason: "Almuerzo" }) }),
    });
    render(<AdminAgenda today={TODAY} />);

    const section = await screen.findByRole("region", { name: "Horario del día" });
    await userEvent.selectOptions(within(section).getByLabelText("Qué"), "break");
    await userEvent.selectOptions(within(section).getByLabelText("Desde"), "13:00");
    await userEvent.selectOptions(within(section).getByLabelText("Hasta"), "14:00");
    await userEvent.type(within(section).getByLabelText("Motivo (opcional)"), "Almuerzo");
    await userEvent.click(within(section).getByRole("button", { name: "Guardar" }));

    expect(postBody(fetchMock)).toEqual({
      date: TODAY,
      kind: "break",
      from: "13:00",
      to: "14:00",
      reason: "Almuerzo",
    });
    expect(await within(section).findByText(/Descanso 1:00–2:00 p\. m\./)).toBeTruthy();
  });

  it("bloquear todo el día no pide horas; abrir más temprano pide solo desde", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/agenda": () => json(200, { appointments: [], exceptions: [] }),
      "POST /api/admin/exceptions": () => json(201, { exception: exception({}) }),
    });
    render(<AdminAgenda today={TODAY} />);

    const section = await screen.findByRole("region", { name: "Horario del día" });
    await userEvent.selectOptions(within(section).getByLabelText("Qué"), "block_day");
    expect(within(section).queryByLabelText("Desde")).toBeNull();
    expect(within(section).queryByLabelText("Hasta")).toBeNull();
    await userEvent.click(within(section).getByRole("button", { name: "Guardar" }));
    expect(postBody(fetchMock)).toEqual({ date: TODAY, kind: "block_day" });

    fetchMock.mockClear();
    await userEvent.selectOptions(within(section).getByLabelText("Qué"), "extra_open");
    expect(within(section).queryByLabelText("Hasta")).toBeNull();
    await userEvent.selectOptions(within(section).getByLabelText("Desde"), "08:00");
    await userEvent.click(within(section).getByRole("button", { name: "Guardar" }));
    expect(postBody(fetchMock)).toEqual({ date: TODAY, kind: "extra_open", from: "08:00" });
  });

  it("si choca con citas, muestra el aviso de la API", async () => {
    const message = "Ya hay citas en esa franja. Muévelas o cancélalas primero.";
    mockApi({
      "GET /api/admin/agenda": () => json(200, { appointments: [], exceptions: [] }),
      "POST /api/admin/exceptions": () =>
        json(409, { error: "exception_conflict", fields: { form: message } }),
    });
    render(<AdminAgenda today={TODAY} />);

    const section = await screen.findByRole("region", { name: "Horario del día" });
    await userEvent.selectOptions(within(section).getByLabelText("Qué"), "block_day");
    await userEvent.click(within(section).getByRole("button", { name: "Guardar" }));

    expect((await within(section).findByRole("alert")).textContent).toBe(message);
  });

  it("un día que ya pasó no se puede cambiar", async () => {
    mockApi({
      "GET /api/admin/agenda": () =>
        json(200, { appointments: [], exceptions: [exception({ date: "2026-11-22" })] }),
    });
    render(<AdminAgenda today={TODAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Día anterior" }));
    const section = await screen.findByRole("region", { name: "Horario del día" });
    expect(
      within(section).getByText("No se puede cambiar el horario de un día que ya pasó."),
    ).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "Guardar" })).toBeNull();
    expect(within(section).queryByRole("button", { name: "Quitar" })).toBeNull();
  });
});

describe("AdminAgenda: horario en la semana y el mes", () => {
  it("la semana muestra una línea por cada elemento cargado", async () => {
    mockApi({
      "GET /api/admin/agenda": () =>
        json(200, { appointments: [], exceptions: [exception({ reason: "Almuerzo" })] }),
    });
    render(<AdminAgenda today={TODAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Semana" }));
    const days = await screen.findAllByRole("region");
    expect(days[0]?.textContent).toContain("Descanso 1:00–2:00 p. m. · Almuerzo");
  });

  it("el mes marca «Bloqueado» los días bloqueados completos", async () => {
    mockApi({
      "GET /api/admin/agenda": () =>
        json(200, {
          appointments: [],
          exceptions: [
            exception({
              date: "2026-11-25",
              kind: "block",
              from: "00:00",
              to: "24:00",
              allDay: true,
            }),
            exception({ id: "e2", date: "2026-11-26" }),
          ],
        }),
    });
    render(<AdminAgenda today={TODAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Mes" }));
    const blocked = await screen.findByRole("button", {
      name: "miércoles 25 de noviembre: 0 citas, bloqueado",
    });
    expect(blocked.textContent).toContain("Bloqueado");
    expect(screen.getByRole("button", { name: "jueves 26 de noviembre: 0 citas" })).toBeTruthy();
  });
});

const ana = { id: "c1", name: "Ana María", phone: "+573001234567" };
const luisa = { id: "c2", name: "Luisa", phone: "+573009876543" };
const catalog = [
  { id: "s1", name: "Semipermanente manos", priceCop: 40000, durationMinutes: 60 },
  { id: "s3", name: "Retiro", priceCop: 15000, durationMinutes: 30 },
];
const booked = (values: Record<string, unknown>) =>
  item({ serviceIds: ["s3", "s1"], client: ana, ...values });

const bodyOf = (fetchMock: ReturnType<typeof mockApi>, method: string) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return JSON.parse(String(call?.[1]?.body));
};

describe("AdminAgenda: citas a nombre de una clienta", () => {
  it("«Nueva cita» busca la clienta, elige servicios, día y hora, y ofrece avisarle", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/agenda": () => json(200, { appointments: [], exceptions: [] }),
      "GET /api/admin/clients": () => json(200, { clients: [ana] }),
      "GET /api/services": () => json(200, { services: catalog }),
      "POST /api/admin/appointments": () =>
        json(201, { appointment: booked({ date: "2026-11-24", time: "10:00" }) }),
    });
    render(<AdminAgenda today={TODAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Nueva cita" }));
    const form = await screen.findByRole("form", { name: "Cita" });
    await userEvent.type(within(form).getByLabelText("Buscar clienta"), "ana");
    await userEvent.click(
      await within(form).findByRole("button", { name: "Ana María · +573001234567" }),
    );
    await userEvent.click(
      await within(form).findByRole("checkbox", { name: /Semipermanente manos/ }),
    );
    await userEvent.click(within(form).getByRole("checkbox", { name: /Retiro/ }));
    expect((within(form).getByLabelText("Día") as HTMLInputElement).value).toBe(TODAY);
    fireEvent.change(within(form).getByLabelText("Día"), { target: { value: "2026-11-24" } });
    await userEvent.selectOptions(within(form).getByLabelText("Hora"), "10:00");
    await userEvent.click(within(form).getByRole("button", { name: "Guardar" }));

    expect(bodyOf(fetchMock, "POST")).toEqual({
      clientId: "c1",
      serviceIds: ["s1", "s3"],
      date: "2026-11-24",
      time: "10:00",
    });
    const done = await screen.findByRole("status");
    expect(done.textContent).toContain("Cita guardada.");
    expect(
      within(done)
        .getByRole("link", { name: "Avisar a Ana María por WhatsApp" })
        .getAttribute("href"),
    ).toBe(
      "https://wa.me/573001234567?text=" +
        encodeURIComponent(
          "Hola Ana María, soy Caro. Te agendé Retiro y Semipermanente manos el martes 24 de noviembre a las 10:00 a. m. ¡Te espero!",
        ),
    );
    expect(screen.queryByRole("form", { name: "Cita" })).toBeNull();
  });

  it("si la hora choca con otra cita, lo dice en el formulario", async () => {
    mockApi({
      "GET /api/admin/agenda": () => json(200, { appointments: [], exceptions: [] }),
      "GET /api/admin/clients": () => json(200, { clients: [ana] }),
      "GET /api/services": () => json(200, { services: catalog }),
      "POST /api/admin/appointments": () =>
        json(409, { error: "slot_taken", fields: { time: "Esa hora choca con otra cita." } }),
    });
    render(<AdminAgenda today={TODAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Nueva cita" }));
    const form = await screen.findByRole("form", { name: "Cita" });
    await userEvent.type(within(form).getByLabelText("Buscar clienta"), "ana");
    await userEvent.click(
      await within(form).findByRole("button", { name: "Ana María · +573001234567" }),
    );
    await userEvent.click(await within(form).findByRole("checkbox", { name: /Retiro/ }));
    await userEvent.click(within(form).getByRole("button", { name: "Guardar" }));

    expect((await within(form).findByRole("alert")).textContent).toBe(
      "Esa hora choca con otra cita.",
    );
  });

  it("un día que ya pasó no ofrece «Nueva cita»", async () => {
    mockApi({ "GET /api/admin/agenda": () => json(200, { appointments: [], exceptions: [] }) });
    render(<AdminAgenda today={TODAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Día anterior" }));
    await screen.findByRole("heading", { name: "domingo 22 de noviembre" });
    expect(screen.queryByRole("button", { name: "Nueva cita" })).toBeNull();
  });

  it("«Editar» trae la cita cargada; mover la hora avisa con el mensaje de cambio", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/agenda": () =>
        json(200, { appointments: [booked({ time: "15:00", canMark: false })], exceptions: [] }),
      "GET /api/services": () => json(200, { services: catalog }),
      "PATCH /api/admin/appointments/a1": () =>
        json(200, { appointment: booked({ time: "16:30", canMark: false }) }),
    });
    render(<AdminAgenda today={TODAY} />);

    const card = nth(await screen.findAllByRole("listitem"), 0);
    await userEvent.click(within(card).getByRole("button", { name: "Editar" }));
    const form = await screen.findByRole("form", { name: "Cita" });
    expect(within(form).getByText("Clienta: Ana María · +573001234567")).toBeTruthy();
    expect(
      ((await within(form).findByRole("checkbox", { name: /Retiro/ })) as HTMLInputElement).checked,
    ).toBe(true);
    expect((within(form).getByLabelText("Hora") as HTMLSelectElement).value).toBe("15:00");
    await userEvent.selectOptions(within(form).getByLabelText("Hora"), "16:30");
    await userEvent.click(within(form).getByRole("button", { name: "Guardar" }));

    expect(bodyOf(fetchMock, "PATCH")).toEqual({
      clientId: "c1",
      serviceIds: ["s1", "s3"],
      date: TODAY,
      time: "16:30",
    });
    const done = await screen.findByRole("status");
    expect(
      within(done)
        .getByRole("link", { name: "Avisar a Ana María por WhatsApp" })
        .getAttribute("href"),
    ).toBe(
      "https://wa.me/573001234567?text=" +
        encodeURIComponent(
          "Hola Ana María, soy Caro. Moví tu cita de Retiro y Semipermanente manos al lunes 23 de noviembre a las 4:30 p. m. ¡Te espero!",
        ),
    );
  });

  it("reasignar a otra clienta le avisa a la nueva con el mensaje de cita agendada", async () => {
    const fetchMock = mockApi({
      "GET /api/admin/agenda": () =>
        json(200, { appointments: [booked({ time: "15:00", canMark: false })], exceptions: [] }),
      "GET /api/services": () => json(200, { services: catalog }),
      "GET /api/admin/clients": () => json(200, { clients: [luisa] }),
      "PATCH /api/admin/appointments/a1": () =>
        json(200, { appointment: booked({ time: "15:00", canMark: false, client: luisa }) }),
    });
    render(<AdminAgenda today={TODAY} />);

    await userEvent.click(
      within(nth(await screen.findAllByRole("listitem"), 0)).getByRole("button", {
        name: "Editar",
      }),
    );
    const form = await screen.findByRole("form", { name: "Cita" });
    await userEvent.click(within(form).getByRole("button", { name: "Cambiar" }));
    await userEvent.type(within(form).getByLabelText("Buscar clienta"), "luisa");
    await userEvent.click(
      await within(form).findByRole("button", { name: "Luisa · +573009876543" }),
    );
    await userEvent.click(within(form).getByRole("button", { name: "Guardar" }));

    expect(bodyOf(fetchMock, "PATCH").clientId).toBe("c2");
    const done = await screen.findByRole("status");
    expect(
      within(done).getByRole("link", { name: "Avisar a Luisa por WhatsApp" }).getAttribute("href"),
    ).toContain(encodeURIComponent("Hola Luisa, soy Caro. Te agendé"));
  });

  it("solo las citas agendadas tienen «Editar»; «Cancelar» cierra el formulario", async () => {
    mockApi({
      "GET /api/admin/agenda": () =>
        json(200, {
          appointments: [
            booked({ time: "15:00", canMark: false }),
            booked({ id: "a2", time: "08:00", status: "completed", canCancel: false }),
          ],
          exceptions: [],
        }),
      "GET /api/services": () => json(200, { services: catalog }),
    });
    render(<AdminAgenda today={TODAY} />);

    const [scheduled, done] = await screen.findAllByRole("listitem");
    expect(within(nth([done], 0)).queryByRole("button", { name: "Editar" })).toBeNull();
    await userEvent.click(within(nth([scheduled], 0)).getByRole("button", { name: "Editar" }));
    await userEvent.click(
      within(await screen.findByRole("form", { name: "Cita" })).getByRole("button", {
        name: "Cancelar",
      }),
    );
    expect(screen.queryByRole("form", { name: "Cita" })).toBeNull();
  });
});
