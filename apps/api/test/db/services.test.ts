import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { services } from "../../src/db/schema.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ db: database.db });
});

beforeEach(async () => {
  await database.pool.query("TRUNCATE users, sessions, rate_limits, services CASCADE");
});

afterAll(async () => {
  await database.pool.end();
});

describe("GET /api/services", () => {
  it("lista los servicios activos en el orden de Caro, sin iniciar sesión", async () => {
    await database.db.insert(services).values([
      { name: "Retiro", priceCop: 15000, durationMinutes: 30, sortOrder: 3 },
      { name: "Semipermanente manos", priceCop: 40000, durationMinutes: 60, sortOrder: 1 },
      { name: "Press on", priceCop: 80000, durationMinutes: 120, sortOrder: 2 },
    ]);

    const response = await request(app).get("/api/services");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      services: [
        {
          id: expect.any(String),
          name: "Semipermanente manos",
          priceCop: 40000,
          durationMinutes: 60,
        },
        { id: expect.any(String), name: "Press on", priceCop: 80000, durationMinutes: 120 },
        { id: expect.any(String), name: "Retiro", priceCop: 15000, durationMinutes: 30 },
      ],
    });
  });

  it("no muestra los servicios desactivados", async () => {
    await database.db.insert(services).values([
      { name: "Retiro", priceCop: 15000, durationMinutes: 30, sortOrder: 1 },
      { name: "Retoque", priceCop: 60000, durationMinutes: 90, sortOrder: 2, active: false },
    ]);

    const response = await request(app).get("/api/services");

    expect(response.body.services.map((service: { name: string }) => service.name)).toEqual([
      "Retiro",
    ]);
  });

  it("con el mismo orden, desempata por nombre", async () => {
    await database.db.insert(services).values([
      { name: "Retoque", priceCop: 60000, durationMinutes: 90, sortOrder: 1 },
      { name: "Retiro", priceCop: 15000, durationMinutes: 30, sortOrder: 1 },
    ]);

    const response = await request(app).get("/api/services");

    expect(response.body.services.map((service: { name: string }) => service.name)).toEqual([
      "Retiro",
      "Retoque",
    ]);
  });

  it("responde una lista vacía si no hay servicios activos", async () => {
    const response = await request(app).get("/api/services");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ services: [] });
  });
});
