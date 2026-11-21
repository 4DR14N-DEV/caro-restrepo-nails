// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyAppointments } from "../src/components/MyAppointments";

const base = { services: ["Retiro"], durationMinutes: 30, totalPriceCop: 15000 };
const list = {
  upcoming: [
    {
      ...base,
      id: "a1",
      date: "2026-11-23",
      time: "09:00",
      services: ["Retiro", "Semipermanente manos"],
      durationMinutes: 90,
      totalPriceCop: 55000,
      state: "upcoming",
    },
  ],
  history: [
    { ...base, id: "a2", date: "2026-11-19", time: "13:00", state: "past" },
    { ...base, id: "a3", date: "2026-11-12", time: "10:00", state: "no_show" },
    { ...base, id: "a4", date: "2026-11-11", time: "10:00", state: "cancelled" },
    { ...base, id: "a5", date: "2026-11-10", time: "10:00", state: "completed" },
  ],
};

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MyAppointments", () => {
  it("sin sesión lleva a ingresar y vuelve a /mis-citas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json(401, { error: "unauthorized" })),
    );
    const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
    render(<MyAppointments />);

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/ingreso?next=%2Fmis-citas"));
  });

  it("muestra las próximas y el historial con día, servicios, duración, total y estado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json(200, list)),
    );
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
  });

  it("sin citas lo dice e invita a reservar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json(200, { upcoming: [], history: [] })),
    );
    render(<MyAppointments />);

    expect(await screen.findByText("No tienes citas próximas.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reservar cita" }).getAttribute("href")).toBe(
      "/reservar",
    );
    expect(screen.getByText("Todavía no tienes citas pasadas.")).toBeTruthy();
  });

  it("si falla la carga, avisa y permite reintentar", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => json(500, { error: "internal_error" }))
      .mockImplementationOnce(() => json(200, list));
    vi.stubGlobal("fetch", fetchMock);
    render(<MyAppointments />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos cargar tus citas. Inténtalo de nuevo en un momento.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("region", { name: "Próximas" })).toBeTruthy();
  });
});
