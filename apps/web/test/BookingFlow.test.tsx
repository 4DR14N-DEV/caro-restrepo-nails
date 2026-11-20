// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingFlow } from "../src/components/BookingFlow";

const ana = { id: "u1", name: "Ana María", phone: "+573001234567", role: "client" };
const catalog = [
  { id: "s1", name: "Semipermanente manos", priceCop: 40000, durationMinutes: 60 },
  { id: "s2", name: "Retoque", priceCop: 60000, durationMinutes: 90 },
  { id: "s3", name: "Retiro", priceCop: 15000, durationMinutes: 30 },
];
const booked = {
  appointment: {
    id: "a1",
    date: "2026-11-23",
    time: "10:00",
    services: ["Semipermanente manos", "Retiro"],
    durationMinutes: 90,
    totalPriceCop: 55000,
  },
  caroWhatsapp: "+573007445676",
};

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

type Handler = (url: URL, init?: RequestInit) => Promise<Response>;

// Responde según el método y la ruta; cada ruta puede tener varias respuestas en orden.
function mockApi(routes: Record<string, Handler | Handler[]>) {
  const used: Record<string, number> = {};
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const url = new URL(path, "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`Ruta sin respuesta en el test: ${key}`);
    const handlers = Array.isArray(route) ? route : [route];
    // Después de la última respuesta se repite la última.
    const handler = handlers[Math.min(used[key] ?? 0, handlers.length - 1)];
    used[key] = (used[key] ?? 0) + 1;
    if (!handler) throw new Error(`Ruta sin respuesta en el test: ${key}`);
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const signedIn = {
  "GET /api/auth/me": () => json(200, { user: ana }),
  "GET /api/services": () => json(200, { services: catalog }),
  "GET /api/booking/days": () => json(200, { days: ["2026-11-23", "2026-11-24"] }),
};

const calls = (fetchMock: ReturnType<typeof mockApi>, pathname: string) =>
  fetchMock.mock.calls.filter(([path]) => new URL(path, "http://localhost").pathname === pathname);

// Marca dos servicios, elige el lunes 23 y espera las horas.
async function pickServicesAndDay() {
  await userEvent.click(await screen.findByRole("checkbox", { name: /Semipermanente manos/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: /Retiro/ }));
  await userEvent.click(screen.getByRole("button", { name: "lun 23 nov" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BookingFlow", () => {
  it("sin sesión lleva a ingresar y vuelve a /reservar", async () => {
    mockApi({ "GET /api/auth/me": () => json(401, { error: "unauthorized" }) });
    const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
    render(<BookingFlow />);

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/ingreso?next=%2Freservar"));
  });

  it("servicios → día → hora → confirmar, y ofrece avisar a Caro por WhatsApp", async () => {
    const fetchMock = mockApi({
      ...signedIn,
      "GET /api/booking/times": () => json(200, { times: ["09:00", "10:00"] }),
      "POST /api/appointments": () => json(201, booked),
    });
    render(<BookingFlow />);

    await pickServicesAndDay();
    const [timesCall] = calls(fetchMock, "/api/booking/times");
    const query = new URL(String(timesCall?.[0]), "http://localhost").searchParams;
    expect(query.get("date")).toBe("2026-11-23");
    expect(query.get("services")).toBe("s1,s3");

    await userEvent.click(await screen.findByRole("button", { name: "10:00 a. m." }));
    expect(screen.getByText("lunes 23 de noviembre a las 10:00 a. m.")).toBeTruthy();
    expect(screen.getByText("2 servicios · 1 h 30 min · $55.000")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    const [bookCall] = calls(fetchMock, "/api/appointments");
    expect(JSON.parse(String(bookCall?.[1]?.body))).toEqual({
      serviceIds: ["s1", "s3"],
      date: "2026-11-23",
      time: "10:00",
    });
    expect(
      await screen.findByRole("heading", { name: "¡Listo! Tu cita quedó confirmada." }),
    ).toBeTruthy();
    const whatsapp = screen.getByRole("link", { name: "Avisar a Caro por WhatsApp" });
    expect(whatsapp.getAttribute("href")).toBe(
      "https://wa.me/573007445676?text=" +
        encodeURIComponent(
          "Hola Caro, soy Ana María. Reservé Semipermanente manos y Retiro el lunes 23 de noviembre a las 10:00 a. m.",
        ),
    );
  });

  it("sin cuenta de Caro confirma igual, sin el botón de WhatsApp", async () => {
    mockApi({
      ...signedIn,
      "GET /api/booking/times": () => json(200, { times: ["10:00"] }),
      "POST /api/appointments": () => json(201, { ...booked, caroWhatsapp: null }),
    });
    render(<BookingFlow />);

    await pickServicesAndDay();
    await userEvent.click(await screen.findByRole("button", { name: "10:00 a. m." }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    expect(
      await screen.findByRole("heading", { name: "¡Listo! Tu cita quedó confirmada." }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Avisar a Caro por WhatsApp" })).toBeNull();
  });

  it("si otra clienta ganó la hora, avisa y recarga las horas", async () => {
    const fetchMock = mockApi({
      ...signedIn,
      "GET /api/booking/times": [
        () => json(200, { times: ["09:00", "10:00"] }),
        () => json(200, { times: ["09:00"] }),
      ],
      "POST /api/appointments": () =>
        json(409, {
          error: "slot_taken",
          fields: { time: "Esa hora ya no está disponible. Elige otra." },
        }),
    });
    render(<BookingFlow />);

    await pickServicesAndDay();
    await userEvent.click(await screen.findByRole("button", { name: "10:00 a. m." }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Esa hora ya no está disponible. Elige otra.",
    );
    await vi.waitFor(() => expect(calls(fetchMock, "/api/booking/times")).toHaveLength(2));
    const times = await screen.findByRole("group", { name: "Horas" });
    await vi.waitFor(() =>
      expect(within(times).queryByRole("button", { name: "10:00 a. m." })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Confirmar reserva" })).toBeNull();
  });

  it("un día sin horas libres lo dice", async () => {
    mockApi({ ...signedIn, "GET /api/booking/times": () => json(200, { times: [] }) });
    render(<BookingFlow />);

    await pickServicesAndDay();
    expect(
      await screen.findByText("No quedan horas libres este día. Prueba con otro."),
    ).toBeTruthy();
  });
});
