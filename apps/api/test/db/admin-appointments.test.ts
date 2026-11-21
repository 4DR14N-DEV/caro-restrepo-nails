import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import {
  appointments,
  appointmentServices,
  scheduleExceptions,
  services,
  users,
} from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { appointmentHelpers, cancelledValues } from "./appointment-helpers.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

// Hoy, para los tests: lunes 23 de noviembre de 2026, 10:00 en Bogotá.
const now = () => new Date("2026-11-23T15:00:00Z");
const TOMORROW = "2026-11-24";

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

const { signedIn, service, appointment, waitForBlocked } = appointmentHelpers(() => database);
const asCaro = () => signedIn("+573007445676", "Caro Restrepo", "admin");

const create = (cookie: string, body: object) =>
  request(app).post("/api/admin/appointments").set("Cookie", cookie).send(body);

const edit = (cookie: string, id: string, body: object) =>
  request(app).patch(`/api/admin/appointments/${id}`).set("Cookie", cookie).send(body);

const stored = async (id: string) => {
  const [row] = await database.db.select().from(appointments).where(eq(appointments.id, id));
  return row;
};

const copiesOf = (id: string) =>
  database.db
    .select({ name: appointmentServices.serviceName, price: appointmentServices.priceCop })
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, id))
    .orderBy(appointmentServices.serviceName);

const slotTaken = {
  error: "slot_taken",
  fields: { time: "Esa hora choca con otra cita." },
};

describe("GET /api/admin/clients", () => {
  it("sin sesión 401; una clienta 403", async () => {
    const client = await signedIn("+573001234567");
    expect((await request(app).get("/api/admin/clients").query({ q: "an" })).status).toBe(401);
    expect(
      (await request(app).get("/api/admin/clients").query({ q: "an" }).set("Cookie", client.cookie))
        .status,
    ).toBe(403);
  });

  it("busca clientas por nombre o celular; no muestra admins ni cuentas borradas", async () => {
    const caro = await asCaro();
    await signedIn("+573001234567", "Ana María");
    await signedIn("+573009876543", "Luisa Ana");
    await signedIn("+573105551234", "Marta");
    await database.db
      .insert(users)
      .values({ name: "Ana Borrada", consentAcceptedAt: new Date(), anonymizedAt: new Date() });
    const search = async (q: string) =>
      (await request(app).get("/api/admin/clients").query({ q }).set("Cookie", caro.cookie)).body
        .clients;

    expect(await search("ana")).toEqual([
      { id: expect.any(String), name: "Ana María", phone: "+573001234567" },
      { id: expect.any(String), name: "Luisa Ana", phone: "+573009876543" },
    ]);
    expect((await search("310 555")).map((c: { name: string }) => c.name)).toEqual(["Marta"]);
    expect(await search("caro")).toEqual([]);
    expect(await search("a")).toEqual([]);
  });
});

describe("POST /api/admin/appointments", () => {
  it("sin sesión 401; una clienta 403; no guarda nada", async () => {
    const ana = await signedIn("+573001234567");
    const retiro = await service("Retiro");
    const body = { clientId: ana.userId, serviceIds: [retiro.id], date: TOMORROW, time: "10:00" };

    expect((await request(app).post("/api/admin/appointments").send(body)).status).toBe(401);
    expect((await create(ana.cookie, body)).status).toBe(403);
    expect(await database.db.select().from(appointments)).toEqual([]);
  });

  it("agenda a nombre de la clienta con los precios del catálogo, creada por Caro", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const manos = await service("Semipermanente manos"); // 60 min, $40.000
    const retiro = await service("Retiro"); // 30 min, $15.000

    const response = await create(caro.cookie, {
      clientId: ana.userId,
      serviceIds: [manos.id, retiro.id],
      date: TOMORROW,
      time: "10:00",
    });

    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.appointment).toEqual({
      id: expect.any(String),
      date: TOMORROW,
      time: "10:00",
      services: ["Retiro", "Semipermanente manos"],
      durationMinutes: 90,
      totalPriceCop: 55000,
      status: "scheduled",
      client: { name: "Ana María", phone: "+573001234567" },
      canMark: false,
      canCancel: true,
    });
    expect(await stored(response.body.appointment.id)).toMatchObject({
      clientId: ana.userId,
      createdBy: "admin",
      startAt: new Date("2026-11-24T15:00:00Z"),
      endAt: new Date("2026-11-24T16:30:00Z"),
      occupiedUntil: new Date("2026-11-24T16:40:00Z"),
      totalPriceCop: 55000,
    });
  });

  it("sin las restricciones de las clientas: hoy, domingos, festivos, días bloqueados y fuera de horario", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const retiro = await service("Retiro");
    await database.db.insert(scheduleExceptions).values({
      kind: "block",
      startsAt: new Date("2026-11-26T05:00:00Z"),
      endsAt: new Date("2026-11-27T05:00:00Z"),
    });

    for (const [date, time] of [
      ["2026-11-23", "12:15"], // hoy, sin los 2 días de anticipación
      ["2026-11-29", "10:00"], // domingo
      ["2026-12-08", "10:00"], // festivo
      ["2026-11-26", "10:00"], // día bloqueado
      ["2026-11-25", "07:15"], // antes de abrir
      ["2027-03-01", "20:30"], // después de la ventana de un mes y del cierre
    ]) {
      const response = await create(caro.cookie, {
        clientId: ana.userId,
        serviceIds: [retiro.id],
        date,
        time,
      });
      expect(response.status, `${date} ${time}`).toBe(201);
    }
  });

  it("no deja pisar otra cita agendada (con su margen); una cancelada no ocupa", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");
    const retiro = await service("Retiro");
    // Martes 10:00–10:30, ocupada hasta las 10:40.
    await appointment(luisa.userId, "2026-11-24T15:00:00Z", ["Retiro"]);
    await appointment(luisa.userId, "2026-11-24T18:00:00Z", ["Retiro"], cancelledValues); // 13:00
    const at = (time: string) =>
      create(caro.cookie, { clientId: ana.userId, serviceIds: [retiro.id], date: TOMORROW, time });

    for (const time of ["10:00", "10:30", "09:45"]) {
      const response = await at(time);
      expect(response.status, time).toBe(409);
      expect(response.body).toEqual(slotTaken);
    }
    expect((await at("10:45")).status).toBe(201);
    expect((await at("13:00")).status).toBe(201);
  });

  it("una hora que ya pasó no se agenda", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const retiro = await service("Retiro");

    for (const [date, time] of [
      ["2026-11-23", "09:45"],
      ["2026-11-22", "15:00"],
    ]) {
      const response = await create(caro.cookie, {
        clientId: ana.userId,
        serviceIds: [retiro.id],
        date,
        time,
      });
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "past_time", fields: { time: "Esa hora ya pasó." } });
    }
  });

  it("solo para clientas con cuenta activa; servicios activos", async () => {
    const caro = await asCaro();
    const retiro = await service("Retiro");
    const [gone] = await database.db
      .insert(users)
      .values({ name: "Borrada", consentAcceptedAt: new Date(), anonymizedAt: new Date() })
      .returning({ id: users.id });
    const ana = await signedIn("+573001234567");
    await database.db.update(services).set({ active: false }).where(eq(services.id, retiro.id));
    const manos = await service("Semipermanente manos");

    for (const clientId of [gone?.id, caro.userId, "00000000-0000-4000-8000-000000000000"]) {
      const response = await create(caro.cookie, {
        clientId,
        serviceIds: [manos.id],
        date: TOMORROW,
        time: "10:00",
      });
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "client_unavailable",
        fields: { clientId: "Esa clienta ya no está disponible." },
      });
    }
    const inactive = await create(caro.cookie, {
      clientId: ana.userId,
      serviceIds: [retiro.id],
      date: TOMORROW,
      time: "10:00",
    });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error).toBe("service_unavailable");
    expect(await database.db.select().from(appointments)).toEqual([]);
  });

  it("rechaza datos inválidos con un mensaje por campo", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const retiro = await service("Retiro");
    const valid = { clientId: ana.userId, serviceIds: [retiro.id], date: TOMORROW, time: "10:00" };

    for (const [body, fields] of [
      [{ ...valid, clientId: "x" }, { clientId: "Elige una clienta." }],
      [{ ...valid, time: "10:10" }, { time: "Elige una hora en múltiplos de 15 minutos." }],
      [{ ...valid, serviceIds: [] }, { serviceIds: "Elige al menos un servicio." }],
      [{ ...valid, priceCop: 0 }, { form: "No se aceptan estos campos: priceCop." }],
    ] as const) {
      const response = await create(caro.cookie, body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_input", fields });
    }
  });

  it("guarda con el turno del día: si otra cita entra en la hora mientras tanto, responde 409", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");
    const retiro = await service("Retiro");
    const other = await database.pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`booking:${TOMORROW}`]);
      const pending = create(caro.cookie, {
        clientId: ana.userId,
        serviceIds: [retiro.id],
        date: TOMORROW,
        time: "10:00",
      }).then((response) => response);
      await waitForBlocked("select pg_advisory_xact_lock");
      await other.query(
        `INSERT INTO appointments (client_id, start_at, end_at, occupied_until, total_price_cop, created_by)
         VALUES ($1, '2026-11-24T15:00:00Z', '2026-11-24T15:30:00Z', '2026-11-24T15:40:00Z', 15000, 'client')`,
        [luisa.userId],
      );
      await other.query("COMMIT");

      const response = await pending;
      expect(response.status).toBe(409);
      expect(response.body).toEqual(slotTaken);
    } finally {
      await other.query("ROLLBACK").catch(() => undefined);
      other.release();
    }
    expect(await database.db.select().from(appointments)).toHaveLength(1);
  });
});

describe("PATCH /api/admin/appointments/:id", () => {
  it("mueve la cita sin tocar sus servicios ni precios si no cambian", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const retiro = await service("Retiro");
    const id = await appointment(ana.userId, "2026-11-24T15:00:00Z", ["Retiro"]); // martes 10:00
    await database.db.update(services).set({ priceCop: 99000 }).where(eq(services.id, retiro.id));

    const response = await edit(caro.cookie, id, {
      clientId: ana.userId,
      serviceIds: [retiro.id],
      date: "2026-11-29",
      time: "08:00",
    });

    expect(response.status).toBe(200);
    expect(response.body.appointment).toMatchObject({
      id,
      date: "2026-11-29",
      time: "08:00",
      totalPriceCop: 15000,
    });
    expect(await stored(id)).toMatchObject({
      startAt: new Date("2026-11-29T13:00:00Z"),
      occupiedUntil: new Date("2026-11-29T13:40:00Z"),
      totalPriceCop: 15000,
    });
    expect(await copiesOf(id)).toEqual([{ name: "Retiro", price: 15000 }]);
  });

  it("si cambian los servicios, los vuelve a copiar con los precios de hoy", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const manos = await service("Semipermanente manos");
    const id = await appointment(ana.userId, "2026-11-24T15:00:00Z", ["Retiro"]);
    await database.db.update(services).set({ priceCop: 45000 }).where(eq(services.id, manos.id));

    const response = await edit(caro.cookie, id, {
      clientId: ana.userId,
      serviceIds: [manos.id],
      date: TOMORROW,
      time: "10:00",
    });

    expect(response.status).toBe(200);
    expect(response.body.appointment).toMatchObject({
      services: ["Semipermanente manos"],
      durationMinutes: 60,
      totalPriceCop: 45000,
    });
    expect(await copiesOf(id)).toEqual([{ name: "Semipermanente manos", price: 45000 }]);
    expect(await stored(id)).toMatchObject({
      endAt: new Date("2026-11-24T16:00:00Z"),
      totalPriceCop: 45000,
    });
  });

  it("reasigna la cita a otra clienta y puede correrla aunque pise su propio horario", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");
    const retiro = await service("Retiro");
    const id = await appointment(ana.userId, "2026-11-24T15:00:00Z", ["Retiro"]);

    const response = await edit(caro.cookie, id, {
      clientId: luisa.userId,
      serviceIds: [retiro.id],
      date: TOMORROW,
      time: "10:15",
    });

    expect(response.status).toBe(200);
    expect(response.body.appointment.client).toEqual({ name: "Luisa", phone: "+573009876543" });
    expect(await stored(id)).toMatchObject({
      clientId: luisa.userId,
      startAt: new Date("2026-11-24T15:15:00Z"),
    });
  });

  it("solo una cita agendada; inexistente 404; no pisa otra cita; no a una hora pasada", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const retiro = await service("Retiro");
    const gone = await appointment(ana.userId, "2026-11-24T15:00:00Z", ["Retiro"], cancelledValues);
    const id = await appointment(ana.userId, "2026-11-24T17:00:00Z", ["Retiro"]); // 12:00
    await appointment(ana.userId, "2026-11-24T19:00:00Z", ["Retiro"]); // 14:00
    const body = (time: string, date = TOMORROW) => ({
      clientId: ana.userId,
      serviceIds: [retiro.id],
      date,
      time,
    });

    const cancelled = await edit(caro.cookie, gone, body("09:00"));
    expect(cancelled.status).toBe(409);
    expect(cancelled.body).toEqual({
      error: "not_editable",
      fields: { form: "Solo se puede editar una cita agendada." },
    });
    for (const missing of ["00000000-0000-4000-8000-000000000000", "no-es-un-id"]) {
      expect((await edit(caro.cookie, missing, body("09:00"))).status).toBe(404);
    }
    const overlap = await edit(caro.cookie, id, body("13:45"));
    expect(overlap.status).toBe(409);
    expect(overlap.body).toEqual(slotTaken);
    const past = await edit(caro.cookie, id, body("09:00", "2026-11-23"));
    expect(past.status).toBe(409);
    expect(past.body.error).toBe("past_time");
    expect((await stored(id))?.startAt).toEqual(new Date("2026-11-24T17:00:00Z"));
  });

  it("espera el turno del día viejo y del nuevo", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const retiro = await service("Retiro");

    for (const held of ["2026-11-24", "2026-11-25"]) {
      await database.pool.query("TRUNCATE appointments, appointment_services CASCADE");
      const id = await appointment(ana.userId, "2026-11-24T15:00:00Z", ["Retiro"]);
      const other = await database.pool.connect();
      try {
        await other.query("BEGIN");
        await other.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`booking:${held}`]);
        const pending = edit(caro.cookie, id, {
          clientId: ana.userId,
          serviceIds: [retiro.id],
          date: "2026-11-25",
          time: "10:00",
        }).then((response) => response);
        await waitForBlocked("select pg_advisory_xact_lock");
        await other.query("COMMIT");
        expect((await pending).status, `turno del ${held}`).toBe(200);
      } finally {
        await other.query("ROLLBACK").catch(() => undefined);
        other.release();
      }
    }
  });
});
