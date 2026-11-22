import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { verifyPassword } from "../../src/auth/password.js";
import { limitKey, loginPhoneLimit } from "../../src/auth/rate-limit.js";
import { createSession } from "../../src/auth/sessions.js";
import { rateLimits, sessions, users } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { appointmentHelpers, cancelledValues } from "./appointment-helpers.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

// Hoy, para los tests: lunes 23 de noviembre de 2026, 10:00 en Bogotá (UTC−5).
const now = () => new Date("2026-11-23T15:00:00Z");

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ db: database.db, now });
});

beforeEach(async () => {
  await database.pool.query(
    "TRUNCATE users, sessions, services, appointments, appointment_services, business_hours, schedule_exceptions, settings, rate_limits CASCADE",
  );
  await seed(database.db);
});

afterAll(async () => {
  await database.pool.end();
});

const { signedIn, appointment } = appointmentHelpers(() => database);
const asCaro = () => signedIn("+573007445676", "Caro Restrepo", "admin");

const list = (cookie: string) => request(app).get("/api/admin/clients/list").set("Cookie", cookie);

const reset = (cookie: string, id: string) =>
  request(app).post(`/api/admin/clients/${id}/password`).set("Cookie", cookie);

const userRow = async (id: string) => {
  const [row] = await database.db.select().from(users).where(eq(users.id, id));
  return row;
};

const sessionsOf = (id: string) =>
  database.db.select().from(sessions).where(eq(sessions.userId, id));

describe("GET /api/admin/clients/list", () => {
  it("sin sesión 401; una clienta 403", async () => {
    const client = await signedIn("+573001234567");
    expect((await request(app).get("/api/admin/clients/list")).status).toBe(401);
    expect((await list(client.cookie)).status).toBe(403);
  });

  it("todas las clientas con cuenta, por nombre, con registro y citas próximas; sin admins ni borradas", async () => {
    const caro = await asCaro();
    const marta = await signedIn("+573105551234", "Marta");
    const ana = await signedIn("+573001234567", "Ana María");
    await database.db
      .update(users)
      .set({ createdAt: new Date("2026-10-05T17:00:00Z") })
      .where(eq(users.id, ana.userId));
    await database.db.insert(users).values({
      name: "Clienta eliminada",
      consentAcceptedAt: new Date(),
      anonymizedAt: new Date(),
    });
    // Ana: dos próximas (una cuenta), una cancelada y una pasada no cuentan.
    await appointment(ana.userId, "2026-11-25T15:00:00Z", ["Semipermanente manos"]);
    await appointment(ana.userId, "2026-11-26T15:00:00Z", ["Semipermanente manos"]);
    await appointment(
      ana.userId,
      "2026-11-27T15:00:00Z",
      ["Semipermanente manos"],
      cancelledValues,
    );
    await appointment(ana.userId, "2026-11-23T14:00:00Z", ["Semipermanente manos"]);

    const response = await list(caro.cookie);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      clients: [
        {
          id: ana.userId,
          name: "Ana María",
          phone: "+573001234567",
          registeredOn: "2026-10-05",
          upcoming: 2,
        },
        {
          id: marta.userId,
          name: "Marta",
          phone: "+573105551234",
          registeredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          upcoming: 0,
        },
      ],
    });
  });
});

describe("POST /api/admin/clients/:id/password", () => {
  it("sin sesión 401; una clienta 403; no cambia la contraseña", async () => {
    const ana = await signedIn("+573001234567");
    const before = (await userRow(ana.userId))?.passwordHash;
    expect((await request(app).post(`/api/admin/clients/${ana.userId}/password`)).status).toBe(401);
    expect((await reset(ana.cookie, ana.userId)).status).toBe(403);
    expect((await userRow(ana.userId))?.passwordHash).toBe(before);
  });

  it("genera una clave de 10 caracteres sin letras que se confundan; la vieja deja de servir", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");

    const response = await reset(caro.cookie, ana.userId);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      client: { id: ana.userId, name: "Ana María", phone: "+573001234567" },
      password: expect.stringMatching(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/),
    });
    const row = await userRow(ana.userId);
    expect(await verifyPassword(row?.passwordHash ?? "", response.body.password)).toBe(true);
    expect(await verifyPassword(row?.passwordHash ?? "", "hash-de-prueba")).toBe(false);

    // Con la clave nueva entra.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ phone: "3001234567", password: response.body.password });
    expect(login.status).toBe(200);

    // Cada vez es otra.
    const again = await reset(caro.cookie, ana.userId);
    expect(again.body.password).not.toBe(response.body.password);
  });

  it("cierra las sesiones de la clienta y le quita el bloqueo por intentos fallidos", async () => {
    const caro = await asCaro();
    const ana = await signedIn("+573001234567");
    await createSession(database.db, ana.userId);
    const key = limitKey(loginPhoneLimit, "+573001234567");
    await database.db.insert(rateLimits).values({
      key,
      attemptCount: 0,
      windowStartedAt: new Date(),
      lockedUntil: new Date(Date.now() + 15 * 60_000),
    });

    expect((await reset(caro.cookie, ana.userId)).status).toBe(200);
    expect(await sessionsOf(ana.userId)).toEqual([]);
    expect(await database.db.select().from(rateLimits).where(eq(rateLimits.key, key))).toEqual([]);
    expect((await request(app).get("/api/auth/me").set("Cookie", ana.cookie)).status).toBe(401);
    // Las sesiones de Caro siguen.
    expect((await sessionsOf(caro.userId)).length).toBe(1);
  });

  it("solo clientas con cuenta: una admin, una borrada o una que no existe → 404 sin cambios", async () => {
    const caro = await asCaro();
    const other = await signedIn("+573009998877", "Otra admin", "admin");
    const before = (await userRow(other.userId))?.passwordHash;
    const [gone] = await database.db
      .insert(users)
      .values({
        name: "Clienta eliminada",
        consentAcceptedAt: new Date(),
        anonymizedAt: new Date(),
      })
      .returning({ id: users.id });

    for (const id of [
      other.userId,
      caro.userId,
      gone?.id ?? "",
      "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
      "no-es-un-id",
    ]) {
      const response = await reset(caro.cookie, id);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not_found" });
    }
    expect((await userRow(other.userId))?.passwordHash).toBe(before);
    expect((await sessionsOf(other.userId)).length).toBe(1);
  });
});
