import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createSession } from "../../src/auth/sessions.js";
import { appointments, appointmentServices, services, users } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

// Hoy, para los tests: viernes 20 de noviembre de 2026, 10:00 en Bogotá.
const now = () => new Date("2026-11-20T15:00:00Z");

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

async function signedIn(role: "admin" | "client", phone: string, name = "Ana María") {
  const [user] = await database.db
    .insert(users)
    .values({ name, phone, passwordHash: "hash-de-prueba", role, consentAcceptedAt: new Date() })
    .returning({ id: users.id });
  if (!user) throw new Error("No se creó la cuenta de prueba.");
  return { userId: user.id, cookie: `session=${await createSession(database.db, user.id)}` };
}

async function serviceId(name: string): Promise<string> {
  const [service] = await database.db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.name, name));
  if (!service) throw new Error(`No existe el servicio ${name}.`);
  return service.id;
}

const book = (cookie: string, body: object) =>
  request(app).post("/api/appointments").set("Cookie", cookie).send(body);

const MONDAY = "2026-11-23";

describe("POST /api/appointments", () => {
  it("sin sesión responde 401 y no guarda nada", async () => {
    const manos = await serviceId("Semipermanente manos");
    const response = await request(app)
      .post("/api/appointments")
      .send({ serviceIds: [manos], date: MONDAY, time: "10:00" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
    expect(await database.db.select().from(appointments)).toEqual([]);
  });

  it("confirma la cita al instante, copia los servicios y devuelve el WhatsApp de Caro", async () => {
    await signedIn("admin", "+573007445676", "Caro Restrepo");
    const { userId, cookie } = await signedIn("client", "+573001234567");
    const manos = await serviceId("Semipermanente manos"); // 60 min, $40.000
    const retiro = await serviceId("Retiro"); // 30 min, $15.000

    const response = await book(cookie, {
      serviceIds: [manos, retiro],
      date: MONDAY,
      time: "10:00",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      appointment: {
        id: expect.any(String),
        date: MONDAY,
        time: "10:00",
        services: ["Semipermanente manos", "Retiro"],
        durationMinutes: 90,
        totalPriceCop: 55000,
      },
      caroWhatsapp: "+573007445676",
    });

    const [saved] = await database.db.select().from(appointments);
    expect(saved).toMatchObject({
      id: response.body.appointment.id,
      clientId: userId,
      status: "scheduled",
      createdBy: "client",
      totalPriceCop: 55000,
      // 10:00 a 11:30 en Bogotá, más 10 minutos de margen.
      startAt: new Date("2026-11-23T15:00:00Z"),
      endAt: new Date("2026-11-23T16:30:00Z"),
      occupiedUntil: new Date("2026-11-23T16:40:00Z"),
    });
    const copies = await database.db.select().from(appointmentServices);
    expect(copies).toHaveLength(2);
    expect(copies).toContainEqual(
      expect.objectContaining({ serviceName: "Retiro", priceCop: 15000, durationMinutes: 30 }),
    );

    // La hora ya no se ofrece; la siguiente libre es fin + margen.
    const { body } = await request(app)
      .get("/api/booking/times")
      .query({ date: MONDAY, services: manos });
    expect(body.times).not.toContain("10:00");
    expect(body.times).toContain("11:40");
  });

  it("sin cuenta de Caro devuelve el WhatsApp vacío", async () => {
    const { cookie } = await signedIn("client", "+573001234567");
    const manos = await serviceId("Semipermanente manos");

    const response = await book(cookie, { serviceIds: [manos], date: MONDAY, time: "10:00" });

    expect(response.status).toBe(201);
    expect(response.body.caroWhatsapp).toBeNull();
  });

  it("responde 409 si la hora no se ofrece y no guarda nada", async () => {
    const { cookie } = await signedIn("client", "+573001234567");
    const manos = await serviceId("Semipermanente manos");

    for (const [date, time] of [
      [MONDAY, "10:15"], // fuera de la grilla
      [MONDAY, "18:30"], // no entra antes del cierre
      ["2026-11-29", "10:00"], // domingo
      ["2026-11-21", "10:00"], // antes de la ventana
      ["2026-12-21", "10:00"], // después de la ventana
    ]) {
      const response = await book(cookie, { serviceIds: [manos], date, time });
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "slot_taken",
        fields: { time: "Esa hora ya no está disponible. Elige otra." },
      });
    }
    expect(await database.db.select().from(appointments)).toEqual([]);
  });

  it("si otra clienta ya tomó la hora, responde 409", async () => {
    const ana = await signedIn("client", "+573001234567");
    const luisa = await signedIn("client", "+573009876543", "Luisa");
    const manos = await serviceId("Semipermanente manos");
    const body = { serviceIds: [manos], date: MONDAY, time: "10:00" };

    expect((await book(ana.cookie, body)).status).toBe(201);
    const second = await book(luisa.cookie, body);

    expect(second.status).toBe(409);
    expect(second.body.error).toBe("slot_taken");
    expect(await database.db.select().from(appointments)).toHaveLength(1);
  });

  it("dos clientas que reservan la misma hora a la vez: una gana y la otra recibe 409", async () => {
    const ana = await signedIn("client", "+573001234567");
    const luisa = await signedIn("client", "+573009876543", "Luisa");
    const manos = await serviceId("Semipermanente manos");
    const body = { serviceIds: [manos], date: MONDAY, time: "10:00" };

    const responses = await Promise.all([book(ana.cookie, body), book(luisa.cookie, body)]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(responses.find((r) => r.status === 409)?.body.error).toBe("slot_taken");
    expect(await database.db.select().from(appointments)).toHaveLength(1);
    expect(await database.db.select().from(appointmentServices)).toHaveLength(1);
  });

  it("si otra reserva se guarda entre el cálculo y el guardado, la base la frena y responde 409", async () => {
    const ana = await signedIn("client", "+573001234567");
    const luisa = await signedIn("client", "+573009876543", "Luisa");
    const manos = await serviceId("Semipermanente manos");

    // Otra conexión guarda la cita de Luisa a las 10:00 sin confirmarla todavía: el cálculo
    // de Ana no la ve, y su guardado queda esperando a la restricción de exclusión.
    const other = await database.pool.connect();
    try {
      await other.query("BEGIN");
      await other.query(
        `INSERT INTO appointments (client_id, start_at, end_at, occupied_until, total_price_cop, created_by)
         VALUES ($1, '2026-11-23T15:00:00Z', '2026-11-23T16:00:00Z', '2026-11-23T16:10:00Z', 40000, 'client')`,
        [luisa.userId],
      );
      const pending = book(ana.cookie, { serviceIds: [manos], date: MONDAY, time: "10:00" }).then(
        (response) => response,
      );
      // Espera a que el guardado de Ana esté bloqueado por la cita sin confirmar.
      for (let waiting = 0; waiting === 0;) {
        const { rows } = await database.pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
        );
        waiting = rows[0].n;
      }
      await other.query("COMMIT");

      const response = await pending;
      expect(response.status).toBe(409);
      expect(response.body.error).toBe("slot_taken");
    } finally {
      other.release();
    }
    const saved = await database.db.select().from(appointments);
    expect(saved.map((appointment) => appointment.clientId)).toEqual([luisa.userId]);
    expect(await database.db.select().from(appointmentServices)).toEqual([]);
  });

  it("responde 409 si algún servicio ya no está disponible", async () => {
    const { cookie } = await signedIn("client", "+573001234567");
    const manos = await serviceId("Semipermanente manos");
    await database.db.update(services).set({ active: false }).where(eq(services.id, manos));

    const response = await book(cookie, { serviceIds: [manos], date: MONDAY, time: "10:00" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("service_unavailable");
    expect(await database.db.select().from(appointments)).toEqual([]);
  });

  it("rechaza datos inválidos con un mensaje por campo", async () => {
    const { cookie } = await signedIn("client", "+573001234567");
    const manos = await serviceId("Semipermanente manos");

    const cases = [
      [{ serviceIds: [manos], date: MONDAY }, { time: "Elige una hora válida." }],
      [{ serviceIds: [manos], date: MONDAY, time: "25:00" }, { time: "Elige una hora válida." }],
      [
        { serviceIds: [], date: MONDAY, time: "10:00" },
        { serviceIds: "Elige al menos un servicio." },
      ],
      [{ serviceIds: [manos], date: "mañana", time: "10:00" }, { date: "Elige una fecha válida." }],
      [
        { serviceIds: [manos], date: MONDAY, time: "10:00", clientId: "otra" },
        { form: "No se aceptan estos campos: clientId." },
      ],
    ] as const;

    for (const [body, fields] of cases) {
      const response = await book(cookie, body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_input", fields });
    }
    expect(await database.db.select().from(appointments)).toEqual([]);
  });
});
