import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createAdmin } from "../../src/auth/admin.js";
import { sessions, users } from "../../src/db/schema.js";
import { createTestDatabase, testDatabaseUrl } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

beforeEach(async () => {
  await database.pool.query("TRUNCATE users, sessions, rate_limits CASCADE");
});

afterAll(async () => {
  await database.pool.end();
});

const caro = { name: "Caro Restrepo", phone: "310 555 1234", password: "clave-de-caro" };

describe("createAdmin", () => {
  it("crea la cuenta admin y con ella se puede ingresar", async () => {
    const user = await createAdmin(database.db, caro);

    expect(user).toMatchObject({ name: "Caro Restrepo", phone: "+573105551234", role: "admin" });

    const response = await request(createApp({ db: database.db }))
      .post("/api/auth/login")
      .send({ phone: "3105551234", password: "clave-de-caro" });
    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("admin");
  });

  it("si el teléfono ya existe, lo vuelve admin y cambia nombre y contraseña", async () => {
    await createAdmin(database.db, caro);
    await database.db.update(users).set({ role: "client" });

    const user = await createAdmin(database.db, {
      ...caro,
      name: "Caro",
      password: "otra-clave-1",
    });

    expect(user).toMatchObject({ name: "Caro", role: "admin" });
    expect(await database.db.select().from(users)).toHaveLength(1);
    const response = await request(createApp({ db: database.db }))
      .post("/api/auth/login")
      .send({ phone: "3105551234", password: "otra-clave-1" });
    expect(response.status).toBe(200);
  });

  // Regresión: si alguien registró antes el celular de Caro, su sesión seguía viva
  // después de la promoción y quedaba con rol admin.
  it("al promover un teléfono existente cierra todas sus sesiones y lo desbloquea", async () => {
    const app = createApp({ db: database.db });
    const squatter = await request(app)
      .post("/api/auth/register")
      .send({ name: "Intrusa", phone: "3105551234", password: "intrusa123", consent: true });
    const cookie = String(squatter.headers["set-cookie"]?.[0]).split(";")[0] ?? "";
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(app)
        .post("/api/auth/login")
        .send({ phone: "3105551234", password: "otra-clave" });
    }

    await createAdmin(database.db, caro);

    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
    expect(await database.db.select().from(sessions)).toHaveLength(0);
    const response = await request(app)
      .post("/api/auth/login")
      .send({ phone: "3105551234", password: "clave-de-caro" });
    expect(response.status).toBe(200);
  });

  it("valida los datos con las mismas reglas del registro", async () => {
    await expect(createAdmin(database.db, { ...caro, password: "corta" })).rejects.toThrow(
      "La contraseña debe tener al menos 8 caracteres.",
    );
    await expect(createAdmin(database.db, { ...caro, phone: "12345" })).rejects.toThrow(
      "Escribe un celular de 10 dígitos que empiece por 3.",
    );
    expect(await database.db.select().from(users)).toHaveLength(0);
  });
});

// El script real, con la entrada por tubería (por ejemplo, desde otro programa).
const apiDir = fileURLToPath(new URL("../../", import.meta.url));

function runCreateAdmin(input: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      "node_modules/.bin/tsx",
      ["src/db/create-admin.ts"],
      { cwd: apiDir, env: { ...process.env, DATABASE_URL: testDatabaseUrl() } },
      (error, stdout, stderr) => {
        // Si el proceso ni siquiera arrancó (por ejemplo, falta tsx), no hay código de
        // salida: se muestra ese error en vez de un fallo confuso en las aserciones.
        if (error && child.exitCode === null) reject(error);
        else resolve({ code: child.exitCode, stdout, stderr });
      },
    );
    child.stdin?.end(input);
  });
}

// Arrancar tsx en frío y conectar a la base puede tardar más que el límite por defecto.
describe("pnpm db:create-admin por tubería", { timeout: 30_000 }, () => {
  it("lee las cuatro respuestas aunque lleguen todas juntas", async () => {
    const result = await runCreateAdmin(
      "Caro Restrepo\n310 555 1234\nclave-de-caro\nclave-de-caro\n",
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Cuenta admin lista: Caro Restrepo (+573105551234).");
    expect(result.stdout).not.toContain("clave-de-caro");
    expect(result.code).toBe(0);
    const [user] = await database.db.select().from(users);
    expect(user).toMatchObject({ phone: "+573105551234", role: "admin" });
  });

  it("si la entrada termina antes de tiempo, cancela sin crear la cuenta", async () => {
    const result = await runCreateAdmin("Caro Restrepo\n310 555 1234\n");

    expect(result.stderr).toContain("Cancelado: no se creó ninguna cuenta.");
    expect(result.code).toBe(1);
    expect(await database.db.select().from(users)).toHaveLength(0);
  });
});
