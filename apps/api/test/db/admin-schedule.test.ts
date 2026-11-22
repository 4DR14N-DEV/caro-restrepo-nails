import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { appointments, scheduleExceptions } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { appointmentHelpers, cancelledValues } from "./appointment-helpers.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

// Hoy, para los tests: lunes 23 de noviembre de 2026, 10:00 en Bogotá (UTC−5). Las clientas
// reservan desde el miércoles 25.
const now = () => new Date("2026-11-23T15:00:00Z");
const WEDNESDAY = "2026-11-25";

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ db: database.db, now });
});

beforeEach(async () => {
  await database.pool.query(
    "TRUNCATE users, sessions, services, appointments, appointment_services, business_hours, schedule_exceptions, settings CASCADE",
  );
  await seed(database.db);
});

afterAll(async () => {
  await database.pool.end();
});

const { signedIn, service, appointment } = appointmentHelpers(() => database);
const asCaro = () => signedIn("+573007445676", "Caro Restrepo", "admin");

type Day = { weekday: number; opensAt: string | null; closesAt: string | null };

const defaultHours = (): Day[] =>
  [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "19:00" }));

const defaultRules = {
  bufferMinutes: 10,
  bookingMinDays: 2,
  bookingMaxMonths: 1,
  cancelMinHours: 2,
  rescheduleMinDays: 2,
};

// El horario por defecto con algunos días cambiados.
const hoursWith = (...changes: Day[]) =>
  defaultHours().map((day) => changes.find((c) => c.weekday === day.weekday) ?? day);

const closed = (weekday: number): Day => ({ weekday, opensAt: null, closesAt: null });

const read = (cookie: string) => request(app).get("/api/admin/schedule").set("Cookie", cookie);

const save = (cookie: string, body: object) =>
  request(app).put("/api/admin/schedule").set("Cookie", cookie).send(body);

async function times(date: string) {
  const manos = await service("Semipermanente manos"); // 60 min
  const { body } = await request(app).get("/api/booking/times").query({ date, services: manos.id });
  return body.times as string[];
}

const days = async () => (await request(app).get("/api/booking/days")).body.days as string[];

describe("/api/admin/schedule", () => {
  it("sin sesión 401; una clienta 403; no cambia nada", async () => {
    const client = await signedIn("+573001234567");
    const body = { hours: hoursWith(closed(6)), rules: defaultRules };
    expect((await request(app).get("/api/admin/schedule")).status).toBe(401);
    expect((await request(app).put("/api/admin/schedule").send(body)).status).toBe(401);
    expect((await read(client.cookie)).status).toBe(403);
    expect((await save(client.cookie, body)).status).toBe(403);
    expect((await read((await asCaro()).cookie)).body.hours).toEqual(defaultHours());
  });

  it("muestra el horario de lunes a sábado y las reglas, sin guardar en caché", async () => {
    const caro = await asCaro();
    const response = await read(caro.cookie);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ hours: defaultHours(), rules: defaultRules });
  });

  it("guarda el horario y el margen, y las reservas los usan; las citas ya agendadas conservan su margen", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    // Jueves 26, 10:00–11:00 en Bogotá, con el margen de antes (10 minutos).
    const before = await appointment(ana.userId, "2026-11-26T15:00:00Z", ["Semipermanente manos"]);
    const hours = hoursWith({ weekday: 3, opensAt: "10:00", closesAt: "12:00" }, closed(6));
    const rules = { ...defaultRules, bufferMinutes: 15 };

    const response = await save(caro.cookie, { hours, rules });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ hours, rules, outside: [] });
    expect((await read(caro.cookie)).body).toEqual({ hours, rules });

    expect(await times(WEDNESDAY)).toEqual(["10:00", "10:30", "11:00"]);
    expect(await days()).not.toContain("2026-11-28");

    const manos = await service("Semipermanente manos");
    const booked = await request(app)
      .post("/api/appointments")
      .set("Cookie", ana.cookie)
      .send({ serviceIds: [manos.id], date: WEDNESDAY, time: "10:00" });
    expect(booked.status).toBe(201);
    const rows = await database.db
      .select({ id: appointments.id, end: appointments.endAt, until: appointments.occupiedUntil })
      .from(appointments);
    const minutesAfter = (id: string) => {
      const row = rows.find((r) => r.id === id);
      return row ? (row.until.getTime() - row.end.getTime()) / 60_000 : undefined;
    };
    expect(minutesAfter(booked.body.appointment.id)).toBe(15);
    expect(minutesAfter(before)).toBe(10);
  });

  it("las reglas de anticipación y de cancelación se aplican a las clientas", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    // Mañana martes 24, 10:00 en Bogotá: faltan 24 horas.
    const tomorrow = await appointment(ana.userId, "2026-11-24T15:00:00Z", [
      "Semipermanente manos",
    ]);
    const rules = { ...defaultRules, bookingMinDays: 3, bookingMaxMonths: 2, cancelMinHours: 48 };
    expect((await save(caro.cookie, { hours: defaultHours(), rules })).status).toBe(200);

    const open = await days();
    expect(open[0]).toBe("2026-11-26");
    const last = open.at(-1) ?? "";
    expect(last > "2026-12-23").toBe(true);
    expect(last <= "2027-01-23").toBe(true);
    const cancel = await request(app)
      .post(`/api/appointments/${tomorrow}/cancel`)
      .set("Cookie", ana.cookie);
    expect(cancel.status).toBe(409);
  });

  it("rechaza datos inválidos con un mensaje por campo y no guarda nada", async () => {
    const caro = await asCaro();
    const response = await save(caro.cookie, {
      hours: hoursWith({ weekday: 1, opensAt: "07:00", closesAt: "19:00" }),
      rules: { ...defaultRules, bufferMinutes: 7 },
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_input",
      fields: {
        hours: "Se puede abrir desde las 8:00 a. m.",
        rules: "El margen va de 0 a 60 minutos, en pasos de 5.",
      },
    });
    expect((await read(caro.cookie)).body).toEqual({ hours: defaultHours(), rules: defaultRules });
  });

  it("avisa las citas agendadas que entraban en el horario y ya no entran, sin tocarlas", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const at = (start: string, values = {}) =>
      appointment(ana.userId, start, ["Semipermanente manos"], values);
    // Miércoles 25, 18:00–19:00: entraba; con cierre a las 18:00 ya no.
    const late = await at("2026-11-25T23:00:00Z");
    // Miércoles 25, 19:30: Caro la agendó fuera de horario (RF11); no se repite en el aviso.
    await at("2026-11-26T00:30:00Z", { createdBy: "admin" });
    // Miércoles 25, 16:00, cancelada: no cuenta.
    await at("2026-11-25T21:00:00Z", cancelledValues);
    // Sábado 28, 10:00: el sábado cierra.
    const saturday = await at("2026-11-28T15:00:00Z");
    // Hoy lunes 23, 9:00: ya pasó.
    await at("2026-11-23T14:00:00Z");
    // Martes 8 de diciembre, festivo: no abre con ningún horario.
    await at("2026-12-08T15:00:00Z", { createdBy: "admin" });

    const hours = hoursWith(
      { weekday: 1, opensAt: "10:00", closesAt: "19:00" },
      closed(2),
      { weekday: 3, opensAt: "09:00", closesAt: "18:00" },
      closed(6),
    );
    const response = await save(caro.cookie, { hours, rules: defaultRules });
    expect(response.status).toBe(200);
    expect(response.body.outside.map((a: { id: string }) => a.id)).toEqual([late, saturday]);
    expect(response.body.outside[0]).toMatchObject({
      date: WEDNESDAY,
      time: "18:00",
      status: "scheduled",
      client: { name: "Ana María" },
    });

    // Las citas no se tocan, y con el mismo horario ya no hay aviso.
    const statuses = await database.db
      .select({ status: appointments.status })
      .from(appointments)
      .where(eq(appointments.id, late));
    expect(statuses).toEqual([{ status: "scheduled" }]);
    expect((await save(caro.cookie, { hours, rules: defaultRules })).body.outside).toEqual([]);
  });

  it("con todos los días cerrados no se ofrece ningún día y avisa las citas agendadas", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    // Miércoles 25, 10:00 en Bogotá.
    const wednesday = await appointment(ana.userId, "2026-11-25T15:00:00Z", [
      "Semipermanente manos",
    ]);
    const hours = [1, 2, 3, 4, 5, 6].map(closed);

    const response = await save(caro.cookie, { hours, rules: defaultRules });
    expect(response.status).toBe(200);
    expect(response.body.hours).toEqual(hours);
    expect(response.body.outside.map((a: { id: string }) => a.id)).toEqual([wednesday]);
    expect((await read(caro.cookie)).body.hours).toEqual(hours);
    expect(await days()).toEqual([]);
  });

  it("los bloqueos, descansos y aperturas tempranas ya cargados se mantienen", async () => {
    const caro = await asCaro();
    const added = await request(app)
      .post("/api/admin/exceptions")
      .set("Cookie", caro.cookie)
      .send({ date: WEDNESDAY, kind: "extra_open", from: "08:00" });
    expect(added.status).toBe(201);
    const stored = () => database.db.select().from(scheduleExceptions);
    const kept = await stored();

    const hours = hoursWith({ weekday: 3, opensAt: "10:00", closesAt: "19:00" });
    expect((await save(caro.cookie, { hours, rules: defaultRules })).status).toBe(200);
    expect(await stored()).toEqual(kept);
  });
});
