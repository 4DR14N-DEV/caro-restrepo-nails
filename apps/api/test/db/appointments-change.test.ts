import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createSession } from "../../src/auth/sessions.js";
import { appointments, users } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { appointmentHelpers, cancelledValues } from "./appointment-helpers.js";
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
    "TRUNCATE users, sessions, services, appointments, appointment_services, business_hours, settings CASCADE",
  );
  await seed(database.db);
});

afterAll(async () => {
  await database.pool.end();
});

const { signedIn, appointment } = appointmentHelpers(() => database);

const stored = async (id: string) => {
  const [row] = await database.db.select().from(appointments).where(eq(appointments.id, id));
  return row;
};

const cancel = (cookie: string, id: string) =>
  request(app).post(`/api/appointments/${id}/cancel`).set("Cookie", cookie);

const tooLate = {
  error: "cancel_too_late",
  fields: { form: "Ya no se puede cancelar esta cita. Escríbele a Caro por WhatsApp." },
};

describe("POST /api/appointments/:id/cancel", () => {
  it("sin sesión responde 401 y no cambia nada", async () => {
    const { userId } = await signedIn("+573001234567");
    const id = await appointment(userId, "2026-11-23T15:00:00Z", ["Retiro"]);

    const response = await request(app).post(`/api/appointments/${id}/cancel`);

    expect(response.status).toBe(401);
    expect((await stored(id))?.status).toBe("scheduled");
  });

  it("cancela una cita propia, registra quién y cuándo, y libera la hora", async () => {
    await database.db.insert(users).values({
      name: "Caro Restrepo",
      phone: "+573007445676",
      passwordHash: "hash-de-prueba",
      role: "admin",
      consentAcceptedAt: new Date(),
    });
    const { userId, cookie } = await signedIn("+573001234567");
    const id = await appointment(userId, "2026-11-23T15:00:00Z", ["Retiro"]); // lunes 10:00

    const response = await cancel(cookie, id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      appointment: expect.objectContaining({
        id,
        date: "2026-11-23",
        time: "10:00",
        services: ["Retiro"],
        state: "cancelled",
        canCancel: false,
        canReschedule: false,
      }),
      caroWhatsapp: "+573007445676",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(await stored(id)).toMatchObject({
      status: "cancelled",
      cancelledBy: "client",
      cancelledAt: now(),
    });

    const retiro = await database.pool.query("SELECT id FROM services WHERE name = 'Retiro'");
    const { body } = await request(app)
      .get("/api/booking/times")
      .query({ date: "2026-11-23", services: retiro.rows[0].id });
    expect(body.times).toContain("10:00");
  });

  it("se puede hasta 2 horas antes; con menos responde 409 y no cambia nada", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    // Ahora son las 10:00: a las 12:00 faltan 2 horas justas; a las 10:30, menos.
    const atTwoHours = await appointment(userId, "2026-11-20T17:00:00Z", ["Retiro"]);
    const tooSoon = await appointment(userId, "2026-11-20T15:30:00Z", ["Retiro"]);

    const ok = await cancel(cookie, atTwoHours);
    expect(ok.status).toBe(200);
    // Sin cuenta de Caro, el aviso por WhatsApp no tiene a quién ir.
    expect(ok.body.caroWhatsapp).toBeNull();

    const late = await cancel(cookie, tooSoon);
    expect(late.status).toBe(409);
    expect(late.body).toEqual(tooLate);
    expect((await stored(tooSoon))?.status).toBe("scheduled");
  });

  it("una admin que cancela su propia cita queda registrada como admin", async () => {
    const [caro] = await database.db
      .insert(users)
      .values({
        name: "Caro Restrepo",
        phone: "+573007445676",
        passwordHash: "hash-de-prueba",
        role: "admin",
        consentAcceptedAt: new Date(),
      })
      .returning({ id: users.id });
    if (!caro) throw new Error("No se creó la admin de prueba.");
    const id = await appointment(caro.id, "2026-11-23T15:00:00Z", ["Retiro"]);
    const cookie = `session=${await createSession(database.db, caro.id)}`;

    expect((await cancel(cookie, id)).status).toBe(200);
    expect(await stored(id)).toMatchObject({ status: "cancelled", cancelledBy: "admin" });
  });

  it("una cita que ya no está agendada no se vuelve a cancelar", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    const cancelled = await appointment(
      userId,
      "2026-11-23T15:00:00Z",
      ["Retiro"],
      cancelledValues,
    );
    const done = await appointment(userId, "2026-11-10T15:00:00Z", ["Retiro"], {
      status: "completed",
    });

    for (const id of [cancelled, done]) {
      const response = await cancel(cookie, id);
      expect(response.status).toBe(409);
      expect(response.body).toEqual(tooLate);
    }
    expect((await stored(done))?.status).toBe("completed");
  });

  it("la cita de otra clienta no se puede cancelar: responde 404 y sigue agendada", async () => {
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");
    const hers = await appointment(luisa.userId, "2026-11-23T15:00:00Z", ["Retiro"]);

    const response = await cancel(ana.cookie, hers);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "not_found" });
    expect((await stored(hers))?.status).toBe("scheduled");
  });

  it("un id inexistente o mal formado responde 404", async () => {
    const { cookie } = await signedIn("+573001234567");
    for (const id of ["00000000-0000-4000-8000-000000000000", "no-es-un-id"]) {
      const response = await cancel(cookie, id);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not_found" });
    }
  });
});

describe("GET /api/appointments: qué se puede cambiar", () => {
  it("marca si cada cita próxima se puede cancelar y reprogramar", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    // Hoy es viernes 20 a las 10:00. Reprogramar: si faltan 2 días o más.
    const inThreeDays = await appointment(userId, "2026-11-23T15:00:00Z", ["Retiro"]); // lunes
    const inTwoDays = await appointment(userId, "2026-11-22T15:00:00Z", ["Retiro"]); // domingo
    const tomorrow = await appointment(userId, "2026-11-21T15:00:00Z", ["Retiro"]); // sábado
    const inOneHour = await appointment(userId, "2026-11-20T16:00:00Z", ["Retiro"]); // hoy 11:00

    const { body } = await request(app).get("/api/appointments").set("Cookie", cookie);
    const flags = Object.fromEntries(
      body.upcoming.map((a: { id: string; canCancel: boolean; canReschedule: boolean }) => [
        a.id,
        [a.canCancel, a.canReschedule],
      ]),
    );

    expect(flags).toEqual({
      [inOneHour]: [false, false],
      [tomorrow]: [true, false],
      [inTwoDays]: [true, true],
      [inThreeDays]: [true, true],
    });
  });

  it("la marca de cancelar coincide con el plazo exacto de 2 horas", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    const atNoon = await appointment(userId, "2026-11-20T17:00:00Z", ["Retiro"]); // 12:00
    const canCancelAt = async (instant: string) => {
      const clock = createApp({ db: database.db, now: () => new Date(instant) });
      const { body } = await request(clock).get("/api/appointments").set("Cookie", cookie);
      return body.upcoming.find((a: { id: string }) => a.id === atNoon)?.canCancel;
    };

    // A las 10:00 faltan 2 horas justas; a las 10:01, un minuto menos.
    expect(await canCancelAt("2026-11-20T15:00:00Z")).toBe(true);
    expect(await canCancelAt("2026-11-20T15:01:00Z")).toBe(false);
  });

  it("el historial nunca se puede cambiar", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    await appointment(userId, "2026-11-25T15:00:00Z", ["Retiro"], cancelledValues);

    const { body } = await request(app).get("/api/appointments").set("Cookie", cookie);

    expect(body.history[0]).toMatchObject({ canCancel: false, canReschedule: false });
  });
});
