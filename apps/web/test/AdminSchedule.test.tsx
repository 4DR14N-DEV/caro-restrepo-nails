// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSchedule } from "../src/components/AdminSchedule";

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

const hours = [1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: "09:00",
  closesAt: "19:00",
}));
const rules = {
  bufferMinutes: 10,
  bookingMinDays: 2,
  bookingMaxMonths: 1,
  cancelMinHours: 2,
  rescheduleMinDays: 2,
};
const loaded = () => json(200, { hours, rules });

const outsideAppointment = (id: string, date: string, time: string) => ({
  id,
  date,
  time,
  services: ["Semipermanente manos"],
  serviceIds: ["s1"],
  durationMinutes: 60,
  totalPriceCop: 45000,
  status: "scheduled",
  client: { id: "c1", name: "Ana María", phone: "+573001234567" },
  canMark: false,
  canCancel: true,
});

const day = (name: string) => within(screen.getByRole("group", { name }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminSchedule: acceso", () => {
  it("sin sesión pide ingresar y vuelve al horario", async () => {
    mockApi({ "GET /api/admin/schedule": () => json(401, { error: "unauthorized" }) });
    render(<AdminSchedule />);

    expect(
      await screen.findByText("Ingresa con la cuenta de Caro para cambiar el horario."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ingresar" }).getAttribute("href")).toBe(
      "/ingreso?next=%2Fadmin%2Fhorario",
    );
  });

  it("con una cuenta que no es admin avisa que es solo para Caro", async () => {
    mockApi({ "GET /api/admin/schedule": () => json(403, { error: "forbidden" }) });
    render(<AdminSchedule />);

    expect(await screen.findByText("Esta página es solo para Caro.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
  });

  it("si falla la carga permite reintentar", async () => {
    let calls = 0;
    mockApi({
      "GET /api/admin/schedule": () => (++calls === 1 ? json(500, { error: "x" }) : loaded()),
    });
    render(<AdminSchedule />);

    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("group", { name: "Lunes" })).toBeTruthy();
  });
});

describe("AdminSchedule: horario y reglas", () => {
  it("muestra cada día de lunes a sábado con sus horas, los cerrados sin horas, y las reglas", async () => {
    mockApi({
      "GET /api/admin/schedule": () =>
        json(200, {
          hours: hours.map((d) =>
            d.weekday === 6 ? { weekday: 6, opensAt: null, closesAt: null } : d,
          ),
          rules,
        }),
    });
    render(<AdminSchedule />);

    await screen.findByRole("group", { name: "Lunes" });
    expect((day("Lunes").getByRole("checkbox", { name: "Abre" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((day("Lunes").getByLabelText("Desde") as HTMLSelectElement).value).toBe("09:00");
    expect((day("Lunes").getByLabelText("Hasta") as HTMLSelectElement).value).toBe("19:00");
    expect(
      (day("Sábado").getByRole("checkbox", { name: "Abre" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(day("Sábado").queryByLabelText("Desde")).toBeNull();
    expect((screen.getByLabelText("Margen entre citas (minutos)") as HTMLInputElement).value).toBe(
      "10",
    );
    expect(screen.queryByRole("group", { name: "Domingo" })).toBeNull();
    expect(screen.getByText("Domingos y festivos no se atiende.")).toBeTruthy();
  });

  it("guarda los cambios: cerrar un día, cambiar horas y reglas", async () => {
    const sent = mockApi({
      "GET /api/admin/schedule": loaded,
      "PUT /api/admin/schedule": (body) => json(200, { ...(body as object), outside: [] }),
    });
    render(<AdminSchedule />);
    await screen.findByRole("group", { name: "Lunes" });

    await userEvent.click(day("Sábado").getByRole("checkbox", { name: "Abre" }));
    await userEvent.selectOptions(day("Miércoles").getByLabelText("Hasta"), "18:00");
    await userEvent.selectOptions(day("Lunes").getByLabelText("Desde"), "08:00");
    const margin = screen.getByLabelText("Margen entre citas (minutos)");
    await userEvent.clear(margin);
    await userEvent.type(margin, "15");
    const cancel = screen.getByLabelText("Cancelar hasta (horas antes de la cita)");
    await userEvent.clear(cancel);
    await userEvent.type(cancel, "24");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Horario guardado.")).toBeTruthy();
    expect(sent.at(-1)).toEqual({
      route: "PUT /api/admin/schedule",
      body: {
        hours: hours.map((d) =>
          d.weekday === 1
            ? { ...d, opensAt: "08:00" }
            : d.weekday === 3
              ? { ...d, closesAt: "18:00" }
              : d.weekday === 6
                ? { weekday: 6, opensAt: null, closesAt: null }
                : d,
        ),
        rules: { ...rules, bufferMinutes: 15, cancelMinHours: 24 },
      },
    });
  });

  it("al abrir un día cerrado propone de 9:00 a. m. a 7:00 p. m.", async () => {
    mockApi({
      "GET /api/admin/schedule": () =>
        json(200, {
          hours: hours.map((d) =>
            d.weekday === 6 ? { weekday: 6, opensAt: null, closesAt: null } : d,
          ),
          rules,
        }),
    });
    render(<AdminSchedule />);
    await screen.findByRole("group", { name: "Sábado" });

    await userEvent.click(day("Sábado").getByRole("checkbox", { name: "Abre" }));
    expect((day("Sábado").getByLabelText("Desde") as HTMLSelectElement).value).toBe("09:00");
    expect((day("Sábado").getByLabelText("Hasta") as HTMLSelectElement).value).toBe("19:00");
  });

  it("avisa las citas que quedan fuera del nuevo horario, con la lista", async () => {
    mockApi({
      "GET /api/admin/schedule": loaded,
      "PUT /api/admin/schedule": (body) =>
        json(200, {
          ...(body as object),
          outside: [
            outsideAppointment("a1", "2026-11-25", "18:00"),
            outsideAppointment("a2", "2026-11-28", "10:00"),
          ],
        }),
    });
    render(<AdminSchedule />);
    await screen.findByRole("group", { name: "Lunes" });
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    const alert = await screen.findByRole("status");
    expect(within(alert).getByText("Hay 2 citas agendadas fuera del nuevo horario.")).toBeTruthy();
    const items = within(alert).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "miércoles 25 de noviembre a las 6:00 p. m. · Ana María · Semipermanente manos",
      "sábado 28 de noviembre a las 10:00 a. m. · Ana María · Semipermanente manos",
    ]);
    expect(within(alert).getByRole("link", { name: "Ver agenda" }).getAttribute("href")).toBe(
      "/admin/agenda",
    );
  });

  it("revisa los datos antes de enviar y muestra el mensaje junto al campo", async () => {
    const sent = mockApi({ "GET /api/admin/schedule": loaded });
    render(<AdminSchedule />);
    await screen.findByRole("group", { name: "Lunes" });

    await userEvent.selectOptions(day("Martes").getByLabelText("Desde"), "12:00");
    await userEvent.selectOptions(day("Martes").getByLabelText("Hasta"), "11:00");
    const margin = screen.getByLabelText("Margen entre citas (minutos)");
    await userEvent.clear(margin);
    await userEvent.type(margin, "7");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      day("Martes").getByText("La hora de cierre tiene que ser después de la de apertura."),
    ).toBeTruthy();
    expect(screen.getByText("El margen va de 0 a 60 minutos, en pasos de 5.")).toBeTruthy();
    expect(sent.map((s) => s.route)).toEqual(["GET /api/admin/schedule"]);
  });

  it("si la sesión venció al guardar, pide ingresar", async () => {
    mockApi({
      "GET /api/admin/schedule": loaded,
      "PUT /api/admin/schedule": () => json(401, { error: "unauthorized" }),
    });
    render(<AdminSchedule />);
    await screen.findByRole("group", { name: "Lunes" });
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("Ingresa con la cuenta de Caro para cambiar el horario."),
    ).toBeTruthy();
  });

  it("si falla al guardar, lo dice y deja los cambios en el formulario", async () => {
    mockApi({
      "GET /api/admin/schedule": loaded,
      "PUT /api/admin/schedule": () => json(500, { error: "x" }),
    });
    render(<AdminSchedule />);
    await screen.findByRole("group", { name: "Lunes" });
    await userEvent.selectOptions(day("Lunes").getByLabelText("Desde"), "10:00");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Algo salió mal. Inténtalo de nuevo en un momento.",
    );
    expect((day("Lunes").getByLabelText("Desde") as HTMLSelectElement).value).toBe("10:00");
  });
});
