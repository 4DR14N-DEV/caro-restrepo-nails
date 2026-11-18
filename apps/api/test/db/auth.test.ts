import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loginThrottles, sessions, users } from "../../src/db/schema.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

const registration = {
  name: "Ana María",
  phone: "300 123 4567",
  password: "secreta123",
  consent: true,
};

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ db: database.db });
});

beforeEach(async () => {
  await database.pool.query("TRUNCATE users, sessions, login_throttles CASCADE");
});

afterAll(async () => {
  await database.pool.end();
});

function setCookies(response: request.Response): string[] {
  const header = response.headers["set-cookie"] as unknown;
  return Array.isArray(header) ? (header as string[]) : [];
}

// Devuelve el token de la cookie de sesión enviada en la respuesta.
function sessionToken(response: request.Response): string | undefined {
  const cookie = setCookies(response).find((value) => value.startsWith("session="));
  return cookie?.split(";")[0]?.slice("session=".length) || undefined;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function register(body: object = registration) {
  return request(app).post("/api/auth/register").send(body);
}

async function login(password: string, phone = "3001234567") {
  return request(app).post("/api/auth/login").send({ phone, password });
}

async function throttleRow(phone = "+573001234567") {
  const [row] = await database.db
    .select()
    .from(loginThrottles)
    .where(eq(loginThrottles.phone, phone));
  return row;
}

describe("POST /api/auth/register", () => {
  it("crea la clienta, inicia sesión y no expone el hash", async () => {
    const response = await register();

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      user: { id: expect.any(String), name: "Ana María", phone: "+573001234567", role: "client" },
    });

    const [user] = await database.db.select().from(users);
    expect(user?.phone).toBe("+573001234567");
    expect(user?.role).toBe("client");
    expect(user?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(user?.consentAcceptedAt).toBeInstanceOf(Date);
  });

  it("envía la cookie de sesión httpOnly, Secure, SameSite=Lax y de 30 días", async () => {
    const response = await register();
    const cookie = setCookies(response).find((value) => value.startsWith("session="));

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${THIRTY_DAYS_SECONDS}`);
  });

  it("guarda solo el hash SHA-256 del token, con vencimiento a 30 días", async () => {
    const token = sessionToken(await register());
    expect(token).toBeDefined();

    const [session] = await database.db.select().from(sessions);
    expect(session?.id).toBe(hashToken(token ?? ""));
    const daysLeft = ((session?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(29.9);
    expect(daysLeft).toBeLessThanOrEqual(30);
  });

  it("responde 400 con un mensaje por campo cuando los datos no son válidos", async () => {
    const response = await register({ ...registration, password: "corta", consent: false });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_input",
      fields: {
        password: "La contraseña debe tener al menos 8 caracteres.",
        consent: "Debes aceptar la política de tratamiento de datos.",
      },
    });
    expect(await database.db.select().from(users)).toHaveLength(0);
  });

  it("responde 409 si el teléfono ya está registrado, aunque se escriba distinto", async () => {
    await register();
    const response = await register({ ...registration, phone: "+57 3001234567" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "phone_taken" });
    expect(setCookies(response)).toHaveLength(0);
  });

  it("responde 400 en JSON cuando el cuerpo no es JSON válido", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send("{malformado");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "invalid_json" });
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await register();
    await database.pool.query("TRUNCATE sessions");
  });

  it("inicia sesión con teléfono y contraseña correctos", async () => {
    const response = await login("secreta123");

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ name: "Ana María", phone: "+573001234567" });
    expect(sessionToken(response)).toBeDefined();
    expect(await database.db.select().from(sessions)).toHaveLength(1);
  });

  it("responde lo mismo si la contraseña es incorrecta o el teléfono no existe", async () => {
    const wrongPassword = await login("otra-clave");
    const unknownPhone = await login("secreta123", "3109999999");

    for (const response of [wrongPassword, unknownPhone]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "invalid_credentials" });
      expect(setCookies(response)).toHaveLength(0);
    }
  });

  it("bloquea el teléfono 15 minutos después de 5 intentos fallidos", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await login("otra-clave")).status).toBe(401);
    }

    // Ni siquiera la contraseña correcta entra mientras dura el bloqueo.
    const response = await login("secreta123");
    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: "too_many_attempts" });
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(890);
    expect(Number(response.headers["retry-after"])).toBeLessThanOrEqual(900);
    expect(setCookies(response)).toHaveLength(0);
  });

  it("bloquea también los teléfonos que no están registrados", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await login("lo-que-sea", "3109999999");
    }

    const response = await login("lo-que-sea", "3109999999");
    expect(response.status).toBe(429);
    expect((await throttleRow("+573109999999"))?.lockedUntil).toBeInstanceOf(Date);
  });

  it("vuelve a permitir el ingreso cuando vence el bloqueo y limpia los fallos", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await login("otra-clave");
    }
    await database.db.update(loginThrottles).set({ lockedUntil: sql`now() - interval '1 second'` });

    const response = await login("secreta123");
    expect(response.status).toBe(200);
    expect(await throttleRow()).toBeUndefined();
  });

  // Regresión: antes cada intento concurrente pasaba el chequeo de bloqueo antes de que
  // se registraran los fallos de los demás.
  it("con intentos simultáneos evalúa como máximo 5 contraseñas", async () => {
    const burst = await Promise.all(
      Array.from({ length: 20 }, (_, index) => login(`otra-clave-${index}`)),
    );
    const statuses = burst.map((response) => response.status);

    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(15);
  });

  it("después de una ráfaga de fallos simultáneos, la contraseña correcta no entra", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => login(`otra-clave-${index}`)));

    const response = await login("secreta123");
    expect(response.status).toBe(429);
    expect((await throttleRow())?.lockedUntil).toBeInstanceOf(Date);
  });

  it("responde 413 si el cuerpo es demasiado grande", async () => {
    const response = await login("x".repeat(200_000));

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "payload_too_large" });
  });

  it("no cuenta los fallos de hace más de 15 minutos", async () => {
    await database.db.insert(loginThrottles).values({
      phone: "+573001234567",
      failedCount: 4,
      windowStartedAt: sql`now() - interval '16 minutes'`,
    });

    expect((await login("otra-clave")).status).toBe(401);
    expect((await login("secreta123")).status).toBe(200);
  });

  it("el ingreso correcto reinicia el conteo de fallos", async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await login("otra-clave");
    }
    expect((await login("secreta123")).status).toBe(200);

    for (let attempt = 0; attempt < 4; attempt++) {
      await login("otra-clave");
    }
    expect((await login("secreta123")).status).toBe(200);
  });

  it("responde 400 si falta la contraseña", async () => {
    const response = await login("");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_input",
      fields: { password: "Escribe tu contraseña." },
    });
  });
});

describe("GET /api/auth/me", () => {
  async function me(token: string | undefined) {
    const call = request(app).get("/api/auth/me");
    return token ? call.set("Cookie", `session=${token}`) : call;
  }

  it("devuelve la usuaria de la sesión", async () => {
    const token = sessionToken(await register());
    const response = await me(token);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ name: "Ana María", role: "client" });
  });

  it("responde 401 sin cookie o con un token desconocido", async () => {
    for (const token of [undefined, "token-inventado"]) {
      const response = await me(token);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "unauthorized" });
    }
  });

  it("responde 401 con una sesión vencida y la borra", async () => {
    const token = sessionToken(await register());
    await database.db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` });

    expect((await me(token)).status).toBe(401);
    expect(await database.db.select().from(sessions)).toHaveLength(0);
  });

  it("renueva la sesión a 30 días cuando le quedan menos de 15", async () => {
    const token = sessionToken(await register());
    await database.db.update(sessions).set({ expiresAt: sql`now() + interval '10 days'` });

    const response = await me(token);

    expect(response.status).toBe(200);
    expect(sessionToken(response)).toBe(token);
    const [session] = await database.db.select().from(sessions);
    const daysLeft = ((session?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(29.9);
  });

  it("no renueva la sesión si le quedan 15 días o más", async () => {
    const token = sessionToken(await register());
    await database.db.update(sessions).set({ expiresAt: sql`now() + interval '20 days'` });

    const response = await me(token);

    expect(response.status).toBe(200);
    expect(setCookies(response)).toHaveLength(0);
  });
});

describe("POST /api/auth/logout", () => {
  it("borra la sesión y la cookie", async () => {
    const token = sessionToken(await register());

    const response = await request(app).post("/api/auth/logout").set("Cookie", `session=${token}`);

    expect(response.status).toBe(204);
    expect(setCookies(response).find((value) => value.startsWith("session="))).toContain(
      "Expires=Thu, 01 Jan 1970",
    );
    expect(await database.db.select().from(sessions)).toHaveLength(0);
    expect((await request(app).get("/api/auth/me").set("Cookie", `session=${token}`)).status).toBe(
      401,
    );
  });

  it("responde 204 aunque no haya sesión", async () => {
    expect((await request(app).post("/api/auth/logout")).status).toBe(204);
  });
});
