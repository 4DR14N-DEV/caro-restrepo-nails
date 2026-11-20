import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { rateLimits, sessions, users } from "../../src/db/schema.js";
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
  // En los tests la IP de la clienta llega en una cabecera, para simular varias.
  app = createApp({ db: database.db, clientIp: (req) => req.get("x-test-ip") ?? "203.0.113.1" });
});

beforeEach(async () => {
  await database.pool.query("TRUNCATE users, sessions, rate_limits CASCADE");
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

async function register(body: object = registration, ip = "203.0.113.1") {
  return request(app).post("/api/auth/register").set("x-test-ip", ip).send(body);
}

async function login(password: string, phone = "3001234567", ip = "203.0.113.1") {
  return request(app).post("/api/auth/login").set("x-test-ip", ip).send({ phone, password });
}

async function limitRow(key: string) {
  const [row] = await database.db.select().from(rateLimits).where(eq(rateLimits.key, key));
  return row;
}

function throttleRow(phone = "+573001234567") {
  return limitRow(`login-phone:${phone}`);
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
    await database.db.update(rateLimits).set({ lockedUntil: sql`now() - interval '1 second'` });

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
    await database.db.insert(rateLimits).values({
      key: "login-phone:+573001234567",
      attemptCount: 4,
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

  it("al ingresar borra la sesión anterior que traía el navegador", async () => {
    const previous = sessionToken(await login("secreta123"));

    const response = await request(app)
      .post("/api/auth/login")
      .set("Cookie", `session=${previous}`)
      .send({ phone: "3001234567", password: "secreta123" });

    expect(response.status).toBe(200);
    const rows = await database.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(hashToken(sessionToken(response) ?? ""));
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

describe("límites por IP y limpieza", () => {
  it("20 ingresos fallidos desde una IP la bloquean, aunque prueben celulares distintos", async () => {
    await register();
    for (let attempt = 0; attempt < 20; attempt++) {
      const phone = `31000000${String(attempt).padStart(2, "0")}`;
      expect((await login("clave-comun", phone, "198.51.100.7")).status).toBe(401);
    }

    // Desde esa IP ya ni la contraseña correcta entra; desde otra IP sí.
    const blocked = await login("secreta123", "3001234567", "198.51.100.7");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(890);
    expect((await login("secreta123", "3001234567", "198.51.100.8")).status).toBe(200);
  });

  it("los ingresos correctos no suman al límite de la IP", async () => {
    await register();
    for (let attempt = 0; attempt < 25; attempt++) {
      expect((await login("secreta123")).status).toBe(200);
    }
    expect((await limitRow("login-ip:203.0.113.1"))?.attemptCount ?? 0).toBe(0);
  });

  it("5 registros desde una IP la bloquean 1 hora", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await register({ ...registration, phone: `320000000${attempt}` });
      expect(response.status).toBe(201);
    }

    const response = await register({ ...registration, phone: "3200000009" });
    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: "too_many_attempts" });
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(3590);
    expect(Number(response.headers["retry-after"])).toBeLessThanOrEqual(3600);
    expect(await database.db.select().from(users)).toHaveLength(5);
  });

  it("los registros con celular repetido también cuentan para el límite", async () => {
    await register();
    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await register()).status).toBe(409);
    }
    expect((await register({ ...registration, phone: "3200000009" })).status).toBe(429);
  });

  it("un error del servidor no cuenta como intento fallido", async () => {
    await register();
    // Un hash dañado hace fallar la verificación con una excepción (500).
    await database.db.update(users).set({ passwordHash: "hash-dañado" });

    const response = await login("secreta123");

    expect(response.status).toBe(500);
    expect((await throttleRow())?.attemptCount ?? 0).toBe(0);
    expect((await limitRow("login-ip:203.0.113.1"))?.attemptCount ?? 0).toBe(0);
  });

  // Regresión: si fallaba la reserva del intento por teléfono, el de la IP quedaba contado.
  it("un error al reservar el intento por teléfono tampoco cuenta para la IP", async () => {
    await register();
    await database.pool.query(`
      CREATE FUNCTION fail_phone_limit() RETURNS trigger AS $$
      BEGIN
        IF NEW.key LIKE 'login-phone:%' THEN RAISE EXCEPTION 'falla simulada'; END IF;
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_phone_limit BEFORE INSERT OR UPDATE ON rate_limits
        FOR EACH ROW EXECUTE FUNCTION fail_phone_limit();
    `);

    try {
      expect((await login("secreta123")).status).toBe(500);
      expect((await limitRow("login-ip:203.0.113.1"))?.attemptCount ?? 0).toBe(0);
    } finally {
      await database.pool.query(`
        DROP TRIGGER fail_phone_limit ON rate_limits;
        DROP FUNCTION fail_phone_limit();
      `);
    }
  });

  // Regresión: con la contraseña correcta, un error al limpiar los intentos dejaba
  // contados el del teléfono y el de la IP.
  it("un error del servidor después de un ingreso correcto no cuenta como intento", async () => {
    await register();
    // Un fallo previo real: tiene que seguir contado, ni inflado ni descontado.
    expect((await login("otra-clave")).status).toBe(401);
    await database.pool.query(`
      CREATE FUNCTION fail_clear() RETURNS trigger AS $$
      BEGIN
        IF OLD.key LIKE 'login-phone:%' THEN RAISE EXCEPTION 'falla simulada al limpiar'; END IF;
        RETURN OLD;
      END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_clear BEFORE DELETE ON rate_limits
        FOR EACH ROW EXECUTE FUNCTION fail_clear();
    `);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect((await login("secreta123")).status).toBe(500);
      expect((await throttleRow())?.attemptCount).toBe(1);
      expect((await limitRow("login-ip:203.0.113.1"))?.attemptCount).toBe(1);
    } finally {
      logged.mockRestore();
      await database.pool.query(`
        DROP TRIGGER fail_clear ON rate_limits;
        DROP FUNCTION fail_clear();
      `);
    }
  });

  it("un error al crear la sesión tampoco cuenta como intento", async () => {
    await register();
    expect((await login("otra-clave")).status).toBe(401);
    await database.pool.query(`
      CREATE FUNCTION fail_session() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'falla simulada de la sesión'; END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_session BEFORE INSERT ON sessions
        FOR EACH ROW EXECUTE FUNCTION fail_session();
    `);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect((await login("secreta123")).status).toBe(500);
      // La contraseña era correcta: los fallos del teléfono ya se habían borrado.
      expect(await throttleRow()).toBeUndefined();
      // El acierto se devolvió una sola vez: queda el fallo previo.
      expect((await limitRow("login-ip:203.0.113.1"))?.attemptCount).toBe(1);
    } finally {
      logged.mockRestore();
      await database.pool.query(`
        DROP TRIGGER fail_session ON sessions;
        DROP FUNCTION fail_session();
      `);
    }
  });

  it("borra las filas de límites vencidas", async () => {
    await database.db.insert(rateLimits).values([
      {
        key: "login-phone:+573111111111",
        attemptCount: 3,
        windowStartedAt: sql`now() - interval '2 hours'`,
      },
      {
        key: "login-ip:192.0.2.1",
        attemptCount: 0,
        windowStartedAt: sql`now() - interval '2 hours'`,
        lockedUntil: sql`now() - interval '1 hour'`,
      },
      { key: "login-phone:+573222222222", attemptCount: 3, windowStartedAt: sql`now()` },
    ]);

    await login("otra-clave");

    expect(await limitRow("login-phone:+573111111111")).toBeUndefined();
    expect(await limitRow("login-ip:192.0.2.1")).toBeUndefined();
    expect(await limitRow("login-phone:+573222222222")).toBeDefined();
  });

  it("si falla la limpieza, el registro y el ingreso siguen funcionando", async () => {
    await database.db.insert(rateLimits).values({
      key: "login-phone:+573111111111",
      attemptCount: 3,
      windowStartedAt: sql`now() - interval '2 hours'`,
    });
    await database.pool.query(`
      CREATE FUNCTION fail_prune() RETURNS trigger AS $$
      BEGIN
        IF OLD.window_started_at <= now() - interval '1 hour' THEN
          RAISE EXCEPTION 'falla simulada de la limpieza';
        END IF;
        RETURN OLD;
      END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_prune BEFORE DELETE ON rate_limits
        FOR EACH ROW EXECUTE FUNCTION fail_prune();
    `);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect((await register()).status).toBe(201);
      expect((await login("secreta123")).status).toBe(200);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      await database.pool.query(`
        DROP TRIGGER fail_prune ON rate_limits;
        DROP FUNCTION fail_prune();
      `);
    }
  });

  it("un error del servidor en el registro no cuenta para el límite de la IP", async () => {
    await database.pool.query(`
      CREATE FUNCTION fail_register() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'falla simulada del registro'; END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_register BEFORE INSERT ON users
        FOR EACH ROW EXECUTE FUNCTION fail_register();
    `);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect((await register()).status).toBe(500);
      expect((await limitRow("register-ip:203.0.113.1"))?.attemptCount ?? 0).toBe(0);
    } finally {
      logged.mockRestore();
      await database.pool.query(`
        DROP TRIGGER fail_register ON users;
        DROP FUNCTION fail_register();
      `);
    }
  });

  it("si además falla devolver el intento, se registra el error original del registro", async () => {
    await database.pool.query(`
      CREATE FUNCTION fail_register() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'falla simulada del registro'; END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_register BEFORE INSERT ON users
        FOR EACH ROW EXECUTE FUNCTION fail_register();
      CREATE FUNCTION fail_release() RETURNS trigger AS $$
      BEGIN
        IF NEW.attempt_count < OLD.attempt_count THEN
          RAISE EXCEPTION 'falla simulada al devolver';
        END IF;
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_release BEFORE UPDATE ON rate_limits
        FOR EACH ROW EXECUTE FUNCTION fail_release();
    `);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect((await register()).status).toBe(500);
      // El manejador de errores registra el último: debe ser el del registro.
      const lastLogged = inspect(logged.mock.calls.at(-1)?.[0]);
      expect(lastLogged).toContain("falla simulada del registro");
      expect(lastLogged).not.toContain("falla simulada al devolver");
      // Y la falla al devolver el intento sí ocurrió y quedó registrada aparte.
      const allLogged = logged.mock.calls.map((call) => inspect(call)).join("\n");
      expect(allLogged).toContain("falla simulada al devolver");
    } finally {
      logged.mockRestore();
      await database.pool.query(`
        DROP TRIGGER fail_register ON users;
        DROP FUNCTION fail_register();
        DROP TRIGGER fail_release ON rate_limits;
        DROP FUNCTION fail_release();
      `);
    }
  });

  it("las IPv6 del mismo bloque /64 comparten el límite de la IP", async () => {
    await register();
    for (let attempt = 0; attempt < 20; attempt++) {
      const phone = `31000000${String(attempt).padStart(2, "0")}`;
      const ip = `2001:db8:1:2::${(attempt + 1).toString(16)}`;
      expect((await login("clave-comun", phone, ip)).status).toBe(401);
    }

    expect((await login("secreta123", "3001234567", "2001:db8:1:2:ffff::1")).status).toBe(429);
    expect((await login("secreta123", "3001234567", "2001:db8:1:3::1")).status).toBe(200);
  });

  it("los registros desde un mismo bloque IPv6 /64 comparten el límite", async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await register(
        { ...registration, phone: `320000000${attempt}` },
        `2001:db8:5:6::${attempt}`,
      );
      expect(response.status).toBe(201);
    }

    const blocked = await register({ ...registration, phone: "3200000006" }, "2001:db8:5:6::6");
    expect(blocked.status).toBe(429);
    const otherBlock = await register({ ...registration, phone: "3200000007" }, "2001:db8:5:7::1");
    expect(otherBlock.status).toBe(201);
  });

  it("una IPv4 escrita como IPv6 comparte el límite con la misma IPv4", async () => {
    await register();
    for (let attempt = 0; attempt < 20; attempt++) {
      const phone = `31000000${String(attempt).padStart(2, "0")}`;
      const ip = attempt % 2 ? "::ffff:198.51.100.7" : "198.51.100.7";
      expect((await login("clave-comun", phone, ip)).status).toBe(401);
    }

    expect((await login("secreta123", "3001234567", "::ffff:c633:6407")).status).toBe(429);
    expect((await login("secreta123", "3001234567", "198.51.100.8")).status).toBe(200);
  });
});
