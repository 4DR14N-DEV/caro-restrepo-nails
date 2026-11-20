import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { createTestDatabase } from "./helpers.js";

// S1a: con la contraseña correcta, un error de la base después de verificarla no cuenta
// como intento ni para el teléfono ni para la IP. Se cubren todos los pasos del acierto.

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;
let withIp = true;

const IP_KEY = "login-ip:203.0.113.1";
const PHONE_KEY = "login-phone:+573001234567";

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ db: database.db, clientIp: () => (withIp ? "203.0.113.1" : undefined) });
});

beforeEach(async () => {
  withIp = true;
  await database.pool.query("TRUNCATE users, sessions, rate_limits CASCADE");
  await request(app)
    .post("/api/auth/register")
    .send({ name: "Ana María", phone: "3001234567", password: "secreta123", consent: true });
});

afterAll(async () => {
  await database.pool.end();
});

function login(password: string, cookie?: string) {
  const req = request(app).post("/api/auth/login");
  if (cookie) req.set("Cookie", cookie);
  return req.send({ phone: "3001234567", password });
}

// Conteo de una clave, o null si no hay fila.
async function count(key: string): Promise<number | null> {
  const { rows } = await database.pool.query<{ attempt_count: number }>(
    "SELECT attempt_count FROM rate_limits WHERE key = $1",
    [key],
  );
  return rows[0] ? rows[0].attempt_count : null;
}

async function withTrigger(
  table: string,
  timing: string,
  condition: string,
  run: () => Promise<void>,
) {
  await database.pool.query(`
    CREATE FUNCTION verify_fail() RETURNS trigger AS $$
    BEGIN
      IF ${condition} THEN RAISE EXCEPTION 'falla simulada'; END IF;
      RETURN COALESCE(NEW, OLD);
    END
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER verify_fail ${timing} ON ${table} FOR EACH ROW EXECUTE FUNCTION verify_fail();
  `);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await run();
  } finally {
    logged.mockRestore();
    await database.pool.query(`DROP TRIGGER verify_fail ON ${table}; DROP FUNCTION verify_fail();`);
  }
}

describe("ingreso correcto con error del servidor (S1a)", () => {
  it("falla al limpiar el teléfono con 3 fallos previos: quedan 3 y 3", async () => {
    for (let i = 0; i < 3; i++) expect((await login("otra-clave")).status).toBe(401);
    expect([await count(PHONE_KEY), await count(IP_KEY)]).toEqual([3, 3]);

    await withTrigger("rate_limits", "BEFORE DELETE", "OLD.key LIKE 'login-phone:%'", async () => {
      expect((await login("secreta123")).status).toBe(500);
    });

    expect([await count(PHONE_KEY), await count(IP_KEY)]).toEqual([3, 3]);
  });

  it("falla al borrar la sesión anterior del navegador: la IP vuelve a su conteo", async () => {
    const first = await login("secreta123");
    const cookie = String(first.headers["set-cookie"]?.[0]).split(";")[0] ?? "";
    expect((await login("otra-clave")).status).toBe(401);

    await withTrigger("sessions", "BEFORE DELETE", "true", async () => {
      expect((await login("secreta123", cookie)).status).toBe(500);
    });

    // El teléfono ya se había limpiado (la contraseña era correcta); la IP no se infla.
    expect(await count(PHONE_KEY)).toBeNull();
    expect(await count(IP_KEY)).toBe(1);
  });

  it("falla al crear la sesión sin IP conocida: el teléfono no se infla", async () => {
    withIp = false;
    expect((await login("otra-clave")).status).toBe(401);
    expect(await count(PHONE_KEY)).toBe(1);

    await withTrigger("rate_limits", "BEFORE DELETE", "OLD.key LIKE 'login-phone:%'", async () => {
      expect((await login("secreta123")).status).toBe(500);
    });

    expect(await count(PHONE_KEY)).toBe(1);
  });

  it("tras el error, el ingreso correcto siguiente funciona y no deja conteo", async () => {
    expect((await login("otra-clave")).status).toBe(401);
    await withTrigger("sessions", "BEFORE INSERT", "true", async () => {
      expect((await login("secreta123")).status).toBe(500);
    });

    expect((await login("secreta123")).status).toBe(200);
    expect(await count(PHONE_KEY)).toBeNull();
    expect(await count(IP_KEY)).toBe(1);
  });
});
