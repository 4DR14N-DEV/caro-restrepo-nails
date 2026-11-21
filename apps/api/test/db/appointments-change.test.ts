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

const { signedIn, appointment, waitForBlocked } = appointmentHelpers(() => database);

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

const reschedule = (cookie: string, id: string, body: object) =>
  request(app).patch(`/api/appointments/${id}`).set("Cookie", cookie).send(body);

const ownTimes = (cookie: string, id: string, date: string) =>
  request(app).get(`/api/appointments/${id}/times`).query({ date }).set("Cookie", cookie);

const tooLateToMove = {
  error: "reschedule_too_late",
  fields: { form: "Ya no se puede reprogramar esta cita. Escríbele a Caro por WhatsApp." },
};

const slotTaken = {
  error: "slot_taken",
  fields: { time: "Esa hora ya no está disponible. Elige otra." },
};

const servicesOf = async (id: string) =>
  (
    await database.pool.query(
      "SELECT service_name, price_cop FROM appointment_services WHERE appointment_id = $1 ORDER BY service_name",
      [id],
    )
  ).rows;

const genericTimes = async (date: string, names: string[]) => {
  const ids = await database.pool.query("SELECT id FROM services WHERE name = ANY($1)", [names]);
  const { body } = await request(app)
    .get("/api/booking/times")
    .query({ date, services: ids.rows.map((row) => row.id).join(",") });
  return body.times as string[];
};

describe("PATCH /api/appointments/:id (reprogramar)", () => {
  it("sin sesión responde 401 y no cambia nada", async () => {
    const { userId } = await signedIn("+573001234567");
    const id = await appointment(userId, "2026-11-23T15:00:00Z", ["Retiro"]);

    const response = await request(app)
      .patch(`/api/appointments/${id}`)
      .send({ date: "2026-11-24", time: "10:00" });

    expect(response.status).toBe(401);
    expect((await stored(id))?.startAt).toEqual(new Date("2026-11-23T15:00:00Z"));
  });

  it("mueve la misma cita, con sus servicios y precios, y libera la hora vieja", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    // Lunes 23 a las 10:00, 90 minutos, $55.000.
    const id = await appointment(userId, "2026-11-23T15:00:00Z", [
      "Semipermanente manos",
      "Retiro",
    ]);

    const response = await reschedule(cookie, id, { date: "2026-11-24", time: "15:00" });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.appointment).toEqual({
      id,
      date: "2026-11-24",
      time: "15:00",
      services: ["Retiro", "Semipermanente manos"],
      durationMinutes: 90,
      totalPriceCop: 55000,
      state: "upcoming",
      canCancel: true,
      canReschedule: true,
    });
    expect(await stored(id)).toMatchObject({
      status: "scheduled",
      startAt: new Date("2026-11-24T20:00:00Z"),
      endAt: new Date("2026-11-24T21:30:00Z"),
      occupiedUntil: new Date("2026-11-24T21:40:00Z"),
      totalPriceCop: 55000,
    });
    expect(await servicesOf(id)).toEqual([
      { service_name: "Retiro", price_cop: 15000 },
      { service_name: "Semipermanente manos", price_cop: 40000 },
    ]);
    expect(await database.db.select().from(appointments)).toHaveLength(1);
    expect(await genericTimes("2026-11-23", ["Retiro"])).toContain("10:00");
  });

  it("se puede mover media hora aunque pise su propio horario", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    const id = await appointment(userId, "2026-11-23T15:00:00Z", [
      "Semipermanente manos",
      "Retiro",
    ]);

    const response = await reschedule(cookie, id, { date: "2026-11-23", time: "10:30" });

    expect(response.status).toBe(200);
    expect((await stored(id))?.startAt).toEqual(new Date("2026-11-23T15:30:00Z"));
  });

  it("si faltan menos de 2 días, o ya no está agendada, responde 409 y no cambia nada", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    // Hoy es viernes 20: el sábado 21 falta 1 día.
    const tomorrow = await appointment(userId, "2026-11-21T15:00:00Z", ["Retiro"]);
    const cancelled = await appointment(
      userId,
      "2026-11-24T15:00:00Z",
      ["Retiro"],
      cancelledValues,
    );

    for (const id of [tomorrow, cancelled]) {
      const response = await reschedule(cookie, id, { date: "2026-11-26", time: "10:00" });
      expect(response.status).toBe(409);
      expect(response.body).toEqual(tooLateToMove);
    }
    expect((await stored(tomorrow))?.startAt).toEqual(new Date("2026-11-21T15:00:00Z"));
  });

  it("si la hora nueva no se ofrece, responde 409 y no cambia nada", async () => {
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");
    const id = await appointment(ana.userId, "2026-11-23T15:00:00Z", ["Retiro"]);
    await appointment(luisa.userId, "2026-11-24T20:00:00Z", ["Retiro"]); // martes 15:00

    for (const [date, time] of [
      ["2026-11-24", "15:00"], // ocupada por Luisa
      ["2026-11-29", "10:00"], // domingo
      ["2026-12-21", "10:00"], // fuera de la ventana
      ["2026-11-24", "10:15"], // fuera de la grilla
    ]) {
      const response = await reschedule(ana.cookie, id, { date, time });
      expect(response.status, `${date} ${time}`).toBe(409);
      expect(response.body).toEqual(slotTaken);
    }
    expect((await stored(id))?.startAt).toEqual(new Date("2026-11-23T15:00:00Z"));
  });

  it("la cita de otra clienta o un id inválido responden 404", async () => {
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");
    const hers = await appointment(luisa.userId, "2026-11-23T15:00:00Z", ["Retiro"]);

    for (const id of [hers, "00000000-0000-4000-8000-000000000000", "no-es-un-id"]) {
      const response = await reschedule(ana.cookie, id, { date: "2026-11-24", time: "10:00" });
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not_found" });
    }
    expect((await stored(hers))?.startAt).toEqual(new Date("2026-11-23T15:00:00Z"));
  });

  it("rechaza datos inválidos con un mensaje por campo", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    const id = await appointment(userId, "2026-11-23T15:00:00Z", ["Retiro"]);

    for (const [body, fields] of [
      [{ date: "2026-11-24" }, { time: "Elige una hora válida." }],
      [{ date: "mañana", time: "10:00" }, { date: "Elige una fecha válida." }],
      [
        { date: "2026-11-24", time: "10:00", serviceIds: [] },
        { form: "No se aceptan estos campos: serviceIds." },
      ],
    ] as const) {
      const response = await reschedule(cookie, id, body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_input", fields });
    }
  });

  it("espera el turno del día viejo y el del nuevo", async () => {
    const { userId, cookie } = await signedIn("+573001234567");

    for (const held of ["2026-11-23", "2026-11-24"]) {
      await database.pool.query("TRUNCATE appointments, appointment_services CASCADE");
      const id = await appointment(userId, "2026-11-23T15:00:00Z", ["Retiro"]);
      const other = await database.pool.connect();
      try {
        await other.query("BEGIN");
        await other.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`booking:${held}`]);
        const pending = reschedule(cookie, id, { date: "2026-11-24", time: "10:00" }).then(
          (response) => response,
        );
        await waitForBlocked("select pg_advisory_xact_lock");
        await other.query("COMMIT");
        expect((await pending).status, `turno del ${held}`).toBe(200);
      } finally {
        await other.query("ROLLBACK").catch(() => undefined);
        other.release();
      }
    }
  });

  it("dos reprogramaciones cruzadas a la vez no se traban", async () => {
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");

    for (let round = 0; round < 5; round++) {
      await database.pool.query("TRUNCATE appointments, appointment_services CASCADE");
      const anas = await appointment(ana.userId, "2026-11-23T15:00:00Z", ["Retiro"]); // lunes
      const luisas = await appointment(luisa.userId, "2026-11-24T15:00:00Z", ["Retiro"]); // martes

      const responses = await Promise.all([
        reschedule(ana.cookie, anas, { date: "2026-11-24", time: "11:00" }),
        reschedule(luisa.cookie, luisas, { date: "2026-11-23", time: "11:00" }),
      ]);

      expect(responses.map((r) => r.status)).toEqual([200, 200]);
    }
  });
});

describe("GET /api/appointments/:id/times (horas para reprogramar)", () => {
  it("ofrece su propio horario y los que lo pisan, con la duración de la cita", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    // 90 minutos el lunes a las 10:00.
    const id = await appointment(userId, "2026-11-23T15:00:00Z", [
      "Semipermanente manos",
      "Retiro",
    ]);

    const response = await ownTimes(cookie, id, "2026-11-23");

    expect(response.status).toBe(200);
    expect(response.body.times).toContain("10:00");
    expect(response.body.times).toContain("10:30");
    expect(response.body.times.at(-1)).toBe("17:30");
    expect(await genericTimes("2026-11-23", ["Retiro"])).not.toContain("10:00");
  });

  it("sin sesión 401; ajena 404; si faltan menos de 2 días 409; fecha inválida 400", async () => {
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");
    const hers = await appointment(luisa.userId, "2026-11-23T15:00:00Z", ["Retiro"]);
    const tomorrow = await appointment(ana.userId, "2026-11-21T15:00:00Z", ["Retiro"]);
    const mine = await appointment(ana.userId, "2026-11-25T15:00:00Z", ["Retiro"]);

    expect((await request(app).get(`/api/appointments/${mine}/times`)).status).toBe(401);
    expect((await ownTimes(ana.cookie, hers, "2026-11-24")).status).toBe(404);
    const late = await ownTimes(ana.cookie, tomorrow, "2026-11-24");
    expect(late.status).toBe(409);
    expect(late.body).toEqual(tooLateToMove);
    const invalid = await ownTimes(ana.cookie, mine, "mañana");
    expect(invalid.status).toBe(400);
    expect(invalid.body.fields).toEqual({ date: "Elige una fecha válida." });
  });
});
