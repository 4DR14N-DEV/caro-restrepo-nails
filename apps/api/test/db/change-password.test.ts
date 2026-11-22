import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/auth/password.js";
import { limitKey, loginPhoneLimit } from "../../src/auth/rate-limit.js";
import { createSession } from "../../src/auth/sessions.js";
import { rateLimits, sessions, users } from "../../src/db/schema.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

const PHONE = "+573001234567";
const CURRENT = "clave-actual-1";

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ db: database.db, clientIp: () => "203.0.113.1" });
});

beforeEach(async () => {
  await database.pool.query("TRUNCATE users, sessions, rate_limits CASCADE");
});

afterAll(async () => {
  await database.pool.end();
});

// Una clienta con contraseña real y dos sesiones: la de este navegador y otra.
async function client() {
  const [user] = await database.db
    .insert(users)
    .values({
      name: "Ana María",
      phone: PHONE,
      passwordHash: await hashPassword(CURRENT),
      consentAcceptedAt: new Date(),
    })
    .returning({ id: users.id });
  if (!user) throw new Error("No se creó la clienta.");
  const here = `session=${await createSession(database.db, user.id)}`;
  const other = `session=${await createSession(database.db, user.id)}`;
  return { id: user.id, here, other };
}

const change = (cookie: string, body: object) =>
  request(app).post("/api/auth/password").set("Cookie", cookie).send(body);

const login = (password: string) =>
  request(app).post("/api/auth/login").send({ phone: "3001234567", password });

const me = (cookie: string) => request(app).get("/api/auth/me").set("Cookie", cookie);

const wrong = {
  error: "wrong_password",
  fields: { currentPassword: "La contraseña actual no es correcta." },
};

describe("POST /api/auth/password", () => {
  it("sin sesión 401", async () => {
    const response = await request(app)
      .post("/api/auth/password")
      .send({ currentPassword: CURRENT, newPassword: "nueva-clave-2" });
    expect(response.status).toBe(401);
  });

  it("cambia la contraseña; la sesión actual sigue y las otras se cierran", async () => {
    const ana = await client();
    const response = await change(ana.here, {
      currentPassword: CURRENT,
      newPassword: "nueva-clave-2",
    });
    expect(response.status).toBe(204);

    expect((await me(ana.here)).status).toBe(200);
    expect((await me(ana.other)).status).toBe(401);
    expect(
      await database.db.select().from(sessions).where(eq(sessions.userId, ana.id)),
    ).toHaveLength(1);
    expect((await login(CURRENT)).status).toBe(401);
    expect((await login("nueva-clave-2")).status).toBe(200);
  });

  it("con la contraseña actual incorrecta no cambia nada", async () => {
    const ana = await client();
    const response = await change(ana.here, {
      currentPassword: "otra-cosa",
      newPassword: "nueva-clave-2",
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual(wrong);
    expect((await me(ana.other)).status).toBe(200);
    expect((await login(CURRENT)).status).toBe(200);
  });

  it("cada intento incorrecto cuenta como un ingreso fallido, con el mismo límite", async () => {
    const ana = await client();
    // Cuatro ingresos fallidos y un cambio con la contraseña incorrecta: son cinco.
    for (let i = 0; i < 4; i++) expect((await login("mala-clave")).status).toBe(401);
    expect(
      (await change(ana.here, { currentPassword: "mala-clave", newPassword: "nueva-clave-2" }))
        .status,
    ).toBe(400);

    // El celular queda bloqueado para ingresar y para cambiar la contraseña.
    expect((await login(CURRENT)).status).toBe(429);
    const blocked = await change(ana.here, {
      currentPassword: CURRENT,
      newPassword: "nueva-clave-2",
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("con la contraseña correcta se borran los fallos anteriores", async () => {
    const ana = await client();
    for (let i = 0; i < 3; i++) expect((await login("mala-clave")).status).toBe(401);
    expect(
      (await change(ana.here, { currentPassword: CURRENT, newPassword: "nueva-clave-2" })).status,
    ).toBe(204);
    const key = limitKey(loginPhoneLimit, PHONE);
    expect(await database.db.select().from(rateLimits).where(eq(rateLimits.key, key))).toEqual([]);
  });

  it("la nueva sigue las reglas del registro; los datos inválidos no cuentan como intento", async () => {
    const ana = await client();
    const response = await change(ana.here, { currentPassword: "", newPassword: "corta" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_input",
      fields: {
        currentPassword: "Escribe tu contraseña actual.",
        newPassword: "La contraseña debe tener al menos 8 caracteres.",
      },
    });
    expect(await database.db.select().from(rateLimits)).toEqual([]);
    expect((await login(CURRENT)).status).toBe(200);
  });
});
