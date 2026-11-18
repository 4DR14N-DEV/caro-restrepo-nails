import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createAdmin } from "../../src/auth/admin.js";
import { sessions, users } from "../../src/db/schema.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

beforeEach(async () => {
  await database.pool.query("TRUNCATE users, sessions, login_throttles CASCADE");
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
