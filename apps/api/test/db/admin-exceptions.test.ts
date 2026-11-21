import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { scheduleExceptions, services } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { appointmentHelpers } from "./appointment-helpers.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

// Hoy, para los tests: lunes 23 de noviembre de 2026, 10:00 en Bogotá. Las clientas
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

const { signedIn, appointment, waitForBlocked } = appointmentHelpers(() => database);
const asCaro = () => signedIn("+573007445676", "Caro Restrepo", "admin");

const add = (cookie: string, body: object) =>
  request(app).post("/api/admin/exceptions").set("Cookie", cookie).send(body);

const remove = (cookie: string, id: string) =>
  request(app).delete(`/api/admin/exceptions/${id}`).set("Cookie", cookie);

const stored = () => database.db.select().from(scheduleExceptions);

async function times(date: string) {
  const [manos] = await database.db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.name, "Semipermanente manos")); // 60 min
  const { body } = await request(app)
    .get("/api/booking/times")
    .query({ date, services: manos?.id });
  return body.times as string[];
}

const days = async () => (await request(app).get("/api/booking/days")).body.days as string[];

const agendaOf = async (cookie: string, date: string) =>
  (
    await request(app)
      .get("/api/admin/agenda")
      .query({ from: date, to: date })
      .set("Cookie", cookie)
  ).body;

describe("POST /api/admin/exceptions", () => {
  it("sin sesión 401; una clienta 403; no guarda nada", async () => {
    const client = await signedIn("+573001234567");
    const body = { date: WEDNESDAY, kind: "block_day" };

    expect((await request(app).post("/api/admin/exceptions").send(body)).status).toBe(401);
    expect((await add(client.cookie, body)).status).toBe(403);
    expect(await stored()).toEqual([]);
  });

  it("bloquear todo el día lo saca de los días para reservar y se ve en la agenda", async () => {
    const caro = await asCaro();

    const response = await add(caro.cookie, {
      date: WEDNESDAY,
      kind: "block_day",
      reason: "Cita médica",
    });

    expect(response.status).toBe(201);
    expect(response.body.exception).toEqual({
      id: expect.any(String),
      date: WEDNESDAY,
      kind: "block",
      from: "00:00",
      to: "24:00",
      allDay: true,
      reason: "Cita médica",
    });
    expect(await days()).not.toContain(WEDNESDAY);
    expect((await agendaOf(caro.cookie, WEDNESDAY)).exceptions).toEqual([response.body.exception]);
  });

  it("un descanso o una franja bloqueada sacan esas horas", async () => {
    const caro = await asCaro();

    const pause = await add(caro.cookie, {
      date: WEDNESDAY,
      kind: "break",
      from: "13:00",
      to: "14:00",
    });
    const block = await add(caro.cookie, {
      date: WEDNESDAY,
      kind: "block",
      from: "16:00",
      to: "17:30",
    });

    expect(pause.status).toBe(201);
    expect(pause.body.exception).toMatchObject({
      kind: "break",
      from: "13:00",
      to: "14:00",
      allDay: false,
      reason: null,
    });
    expect(block.status).toBe(201);
    const offered = await times(WEDNESDAY);
    expect(offered).toContain("12:00");
    expect(offered).not.toContain("13:00");
    expect(offered).toContain("14:00");
    expect(offered).not.toContain("16:00");
    expect(offered).toContain("17:30");
  });

  it("abrir más temprano va desde la hora elegida hasta la apertura habitual", async () => {
    const caro = await asCaro();

    const response = await add(caro.cookie, { date: WEDNESDAY, kind: "extra_open", from: "08:00" });

    expect(response.status).toBe(201);
    expect(response.body.exception).toMatchObject({
      kind: "extra_open",
      from: "08:00",
      to: "09:00",
    });
    expect((await times(WEDNESDAY)).slice(0, 3)).toEqual(["08:00", "08:30", "09:00"]);
  });

  it("abrir más temprano solo en días que abren, desde las 8:00 y antes de la apertura", async () => {
    const caro = await asCaro();
    const cases = [
      [
        { date: "2026-11-29", kind: "extra_open", from: "08:00" },
        409,
        "Ese día no abre: no se puede abrir más temprano.",
      ], // domingo
      [
        { date: "2026-12-08", kind: "extra_open", from: "08:00" },
        409,
        "Ese día no abre: no se puede abrir más temprano.",
      ], // festivo
      [
        { date: WEDNESDAY, kind: "extra_open", from: "09:00" },
        409,
        "Elige una hora antes de la apertura de ese día (9:00 a. m.).",
      ],
    ] as const;

    for (const [body, status, form] of cases) {
      const response = await add(caro.cookie, body);
      expect(response.status, body.date).toBe(status);
      expect(response.body.fields).toEqual({ form });
    }
    const early = await add(caro.cookie, { date: WEDNESDAY, kind: "extra_open", from: "07:30" });
    expect(early.status).toBe(400);
    expect(early.body.fields).toEqual({ from: "Se puede abrir desde las 8:00." });
    expect(await stored()).toEqual([]);
  });

  it("un bloqueo o descanso que pisa una cita agendada se rechaza", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    // Miércoles 10:00–10:30 (Retiro), con margen hasta las 10:40.
    await appointment(ana.userId, "2026-11-25T15:00:00Z", ["Retiro"]);

    for (const body of [
      { date: WEDNESDAY, kind: "block_day" },
      { date: WEDNESDAY, kind: "break", from: "10:15", to: "11:00" },
      { date: WEDNESDAY, kind: "block", from: "09:00", to: "10:15" },
    ]) {
      const response = await add(caro.cookie, body);
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "exception_conflict",
        fields: { form: "Ya hay citas en esa franja. Muévelas o cancélalas primero." },
      });
    }
    expect(await stored()).toEqual([]);

    // Justo después de la cita, dentro de su margen, sí: el margen no se exige antes de un descanso.
    expect(
      (await add(caro.cookie, { date: WEDNESDAY, kind: "break", from: "10:30", to: "11:00" }))
        .status,
    ).toBe(201);
  });

  it("solo de hoy en adelante", async () => {
    const caro = await asCaro();

    const past = await add(caro.cookie, { date: "2026-11-22", kind: "block_day" });
    expect(past.status).toBe(409);
    expect(past.body).toEqual({
      error: "past_day",
      fields: { form: "No se puede cambiar el horario de un día que ya pasó." },
    });
    expect(
      (await add(caro.cookie, { date: "2026-11-23", kind: "break", from: "13:00", to: "14:00" }))
        .status,
    ).toBe(201);
  });

  it("rechaza datos inválidos con un mensaje por campo", async () => {
    const caro = await asCaro();
    for (const [body, fields] of [
      [{ date: WEDNESDAY, kind: "nap" }, { kind: "Elige qué quieres cargar." }],
      [{ date: WEDNESDAY, kind: "break", to: "14:00" }, { from: "Elige la hora de inicio." }],
      [{ date: WEDNESDAY, kind: "break", from: "13:00" }, { to: "Elige la hora de fin." }],
      [
        { date: WEDNESDAY, kind: "break", from: "13:10", to: "14:00" },
        { from: "Elige una hora en múltiplos de 15 minutos." },
      ],
      [
        { date: WEDNESDAY, kind: "block", from: "14:00", to: "13:00" },
        { to: "La hora de fin tiene que ser después de la de inicio." },
      ],
      [
        { date: WEDNESDAY, kind: "block_day", reason: "x".repeat(101) },
        { reason: "El motivo puede tener hasta 100 caracteres." },
      ],
      [
        { date: WEDNESDAY, kind: "block_day", clientId: "x" },
        { form: "No se aceptan estos campos: clientId." },
      ],
    ] as const) {
      const response = await add(caro.cookie, body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_input", fields });
    }
    expect(await stored()).toEqual([]);
  });

  it("guarda con el turno del día: si una clienta reserva en la franja mientras tanto, lo rechaza", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const other = await database.pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`booking:${WEDNESDAY}`]);
      const pending = add(caro.cookie, {
        date: WEDNESDAY,
        kind: "break",
        from: "13:00",
        to: "14:00",
      }).then((response) => response);
      await waitForBlocked("select pg_advisory_xact_lock");
      // La reserva que tenía el turno guarda una cita a las 13:00.
      await other.query(
        `INSERT INTO appointments (client_id, start_at, end_at, occupied_until, total_price_cop, created_by)
         VALUES ($1, '2026-11-25T18:00:00Z', '2026-11-25T18:30:00Z', '2026-11-25T18:40:00Z', 15000, 'client')`,
        [ana.userId],
      );
      await other.query("COMMIT");

      const response = await pending;
      expect(response.status).toBe(409);
      expect(response.body.error).toBe("exception_conflict");
    } finally {
      await other.query("ROLLBACK").catch(() => undefined);
      other.release();
    }
    expect(await stored()).toEqual([]);
  });
});

describe("DELETE /api/admin/exceptions/:id", () => {
  it("quitar un bloqueo devuelve las horas", async () => {
    const caro = await asCaro();
    const { body } = await add(caro.cookie, {
      date: WEDNESDAY,
      kind: "break",
      from: "13:00",
      to: "14:00",
    });

    const response = await remove(caro.cookie, body.exception.id);

    expect(response.status).toBe(204);
    expect(await stored()).toEqual([]);
    expect(await times(WEDNESDAY)).toContain("13:00");
  });

  it("sin sesión 401; clienta 403; inexistente o mal formado 404; del pasado 409", async () => {
    const caro = await asCaro();
    const client = await signedIn("+573001234567");
    const { body } = await add(caro.cookie, { date: WEDNESDAY, kind: "block_day" });
    const [past] = await database.db
      .insert(scheduleExceptions)
      .values({
        kind: "block",
        startsAt: new Date("2026-11-20T15:00:00Z"),
        endsAt: new Date("2026-11-20T16:00:00Z"),
      })
      .returning({ id: scheduleExceptions.id });
    if (!past) throw new Error("No se guardó el bloqueo del pasado.");

    expect((await request(app).delete(`/api/admin/exceptions/${body.exception.id}`)).status).toBe(
      401,
    );
    expect((await remove(client.cookie, body.exception.id)).status).toBe(403);
    for (const id of ["00000000-0000-4000-8000-000000000000", "no-es-un-id"]) {
      const response = await remove(caro.cookie, id);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not_found" });
    }
    const old = await remove(caro.cookie, past.id);
    expect(old.status).toBe(409);
    expect(old.body.error).toBe("past_day");
    expect(await stored()).toHaveLength(2);
  });
});
