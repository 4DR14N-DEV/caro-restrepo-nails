import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { users } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { appointmentHelpers, cancelledValues } from "./appointment-helpers.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

// Hoy, para los tests: lunes 23 de noviembre de 2026, 10:00 en Bogotá.
const now = () => new Date("2026-11-23T15:00:00Z");

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
const asCaro = () => signedIn("+573007445676", "Caro Restrepo", "admin");

const agenda = (cookie: string, query: Record<string, string>) =>
  request(app).get("/api/admin/agenda").query(query).set("Cookie", cookie);

describe("GET /api/admin/agenda", () => {
  it("sin sesión 401; una clienta 403", async () => {
    const client = await signedIn("+573001234567");
    const query = { from: "2026-11-23", to: "2026-11-23" };

    expect((await request(app).get("/api/admin/agenda").query(query)).status).toBe(401);
    const forbidden = await agenda(client.cookie, query);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ error: "forbidden" });
  });

  it("devuelve las citas del rango en orden, con la clienta, servicios, total y estado", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");
    const later = await appointment(luisa.userId, "2026-11-23T20:00:00Z", ["Retiro"]); // 15:00
    const first = await appointment(ana.userId, "2026-11-23T14:00:00Z", [
      "Semipermanente manos",
      "Retiro",
    ]); // 9:00
    await appointment(ana.userId, "2026-11-24T15:00:00Z", ["Retiro"]); // otro día

    const response = await agenda(caro.cookie, { from: "2026-11-23", to: "2026-11-23" });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.appointments).toEqual([
      {
        id: first,
        date: "2026-11-23",
        time: "09:00",
        services: ["Retiro", "Semipermanente manos"],
        durationMinutes: 90,
        totalPriceCop: 55000,
        status: "scheduled",
        client: { name: "Ana María", phone: "+573001234567" },
        canMark: true,
        canCancel: true,
      },
      expect.objectContaining({
        id: later,
        time: "15:00",
        client: { name: "Luisa", phone: "+573009876543" },
      }),
    ]);
  });

  it("una semana trae todos sus días; una cita a las 11:30 p. m. cae en su día de Bogotá", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    await appointment(ana.userId, "2026-11-23T15:00:00Z", ["Retiro"]); // lunes
    await appointment(ana.userId, "2026-11-29T04:30:00Z", ["Retiro"]); // sábado 28, 23:30
    await appointment(ana.userId, "2026-11-30T15:00:00Z", ["Retiro"]); // lunes siguiente

    const { body } = await agenda(caro.cookie, { from: "2026-11-23", to: "2026-11-28" });

    expect(
      body.appointments.map((a: { date: string; time: string }) => `${a.date} ${a.time}`),
    ).toEqual(["2026-11-23 10:00", "2026-11-28 23:30"]);
  });

  it("oculta las canceladas salvo que se pidan", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    const kept = await appointment(ana.userId, "2026-11-23T15:00:00Z", ["Retiro"]);
    const gone = await appointment(ana.userId, "2026-11-23T17:00:00Z", ["Retiro"], cancelledValues);
    const range = { from: "2026-11-23", to: "2026-11-23" };

    const hidden = await agenda(caro.cookie, range);
    expect(hidden.body.appointments.map((a: { id: string }) => a.id)).toEqual([kept]);

    const off = await agenda(caro.cookie, { ...range, cancelled: "0" });
    expect(off.body.appointments.map((a: { id: string }) => a.id)).toEqual([kept]);

    const shown = await agenda(caro.cookie, { ...range, cancelled: "1" });
    expect(
      shown.body.appointments.map((a: { id: string; status: string }) => [a.id, a.status]),
    ).toEqual([
      [kept, "scheduled"],
      [gone, "cancelled"],
    ]);
  });

  it("marca qué se puede hacer: marcar si ya empezó, cancelar si está agendada", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    // Ahora son las 10:00.
    const started = await appointment(ana.userId, "2026-11-23T14:00:00Z", ["Retiro"]); // 9:00
    const pending = await appointment(ana.userId, "2026-11-23T17:00:00Z", ["Retiro"]); // 12:00
    const done = await appointment(ana.userId, "2026-11-23T13:00:00Z", ["Retiro"], {
      status: "completed",
    }); // 8:00
    const gone = await appointment(ana.userId, "2026-11-23T19:00:00Z", ["Retiro"], cancelledValues);

    const { body } = await agenda(caro.cookie, {
      from: "2026-11-23",
      to: "2026-11-23",
      cancelled: "1",
    });
    const flags = Object.fromEntries(
      body.appointments.map((a: { id: string; canMark: boolean; canCancel: boolean }) => [
        a.id,
        [a.canMark, a.canCancel],
      ]),
    );

    expect(flags).toEqual({
      [started]: [true, true],
      [pending]: [false, true],
      [done]: [true, false],
      [gone]: [false, false],
    });
  });

  it("de una clienta anonimizada muestra el nombre sin celular", async () => {
    const caro = await asCaro();
    const [gone] = await database.db
      .insert(users)
      .values({ name: "Cuenta borrada", consentAcceptedAt: new Date(), anonymizedAt: new Date() })
      .returning({ id: users.id });
    if (!gone) throw new Error("No se creó la cuenta anonimizada.");
    await appointment(gone.id, "2026-11-23T15:00:00Z", ["Retiro"]);

    const { body } = await agenda(caro.cookie, { from: "2026-11-23", to: "2026-11-23" });

    expect(body.appointments[0].client).toEqual({ name: "Cuenta borrada", phone: null });
  });

  it("rechaza un rango inválido o de más de 42 días", async () => {
    const caro = await asCaro();
    for (const [query, fields] of [
      [{ to: "2026-11-23" }, { from: "Elige una fecha válida." }],
      [
        { from: "2026-11-24", to: "2026-11-23" },
        { to: "La fecha final no puede ser anterior a la inicial." },
      ],
      [
        { from: "2026-11-23", to: "2026-11-23", cancelled: "si" },
        { cancelled: "Usa 0 o 1 para mostrar las canceladas." },
      ],
      [{ from: "2026-11-01", to: "2026-12-13" }, { to: "Elige un rango de hasta 42 días." }],
    ] as const) {
      const response = await agenda(caro.cookie, query);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_input", fields });
    }
    // 42 días justos sí.
    expect((await agenda(caro.cookie, { from: "2026-11-01", to: "2026-12-12" })).status).toBe(200);
  });

  it("se puede marcar justo cuando empieza; dos citas a la misma hora salen en orden fijo", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    // Empieza exactamente ahora (10:00); la otra, cancelada, a la misma hora.
    const atNow = await appointment(ana.userId, "2026-11-23T15:00:00Z", ["Retiro"]);
    const twin = await appointment(ana.userId, "2026-11-23T15:00:00Z", ["Retiro"], cancelledValues);

    for (let attempt = 0; attempt < 3; attempt++) {
      const { body } = await agenda(caro.cookie, {
        from: "2026-11-23",
        to: "2026-11-23",
        cancelled: "1",
      });
      expect(body.appointments.map((a: { id: string }) => a.id)).toEqual([atNow, twin].sort());
      expect(body.appointments.find((a: { id: string }) => a.id === atNow).canMark).toBe(true);
    }
  });

  it("una cita sin servicios guardados sale con la lista vacía", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    await database.pool.query(
      `INSERT INTO appointments (client_id, start_at, end_at, occupied_until, total_price_cop, created_by)
       VALUES ($1, '2026-11-23T15:00:00Z', '2026-11-23T15:30:00Z', '2026-11-23T15:40:00Z', 0, 'admin')`,
      [ana.userId],
    );

    const { body } = await agenda(caro.cookie, { from: "2026-11-23", to: "2026-11-23" });

    expect(body.appointments[0].services).toEqual([]);
  });

  it("una ruta de admin que no existe sigue respondiendo 404", async () => {
    const response = await request(app).get("/api/admin/no-existe");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "not_found" });
  });
});
