import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessHours, services, settings } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await seed(database.db);
});

afterAll(async () => {
  await database.pool.end();
});

describe("seed", () => {
  it("carga el catálogo real de servicios con precio en COP y duración en minutos", async () => {
    const rows = await database.db
      .select({
        name: services.name,
        priceCop: services.priceCop,
        durationMinutes: services.durationMinutes,
        active: services.active,
      })
      .from(services)
      .orderBy(asc(services.sortOrder));

    expect(rows).toEqual([
      { name: "Semipermanente manos", priceCop: 40000, durationMinutes: 60, active: true },
      { name: "Semipermanente pies", priceCop: 40000, durationMinutes: 60, active: true },
      {
        name: "Semipermanente con baño de acrílico",
        priceCop: 60000,
        durationMinutes: 90,
        active: true,
      },
      {
        name: "Semipermanente con base rubber",
        priceCop: 60000,
        durationMinutes: 90,
        active: true,
      },
      { name: "Press on", priceCop: 80000, durationMinutes: 120, active: true },
      { name: "Retoque", priceCop: 60000, durationMinutes: 90, active: true },
      { name: "Acrílico con tips", priceCop: 100000, durationMinutes: 150, active: true },
      { name: "Acrílicas esculpidas", priceCop: 120000, durationMinutes: 180, active: true },
      { name: "Retoque de acrílico", priceCop: 80000, durationMinutes: 150, active: true },
      { name: "Retiro", priceCop: 15000, durationMinutes: 30, active: true },
    ]);
  });

  it("carga el horario base de lunes a sábado de 9:00 a 19:00", async () => {
    const rows = await database.db.select().from(businessHours).orderBy(asc(businessHours.weekday));

    expect(rows).toEqual(
      [1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        opensAt: "09:00:00",
        closesAt: "19:00:00",
      })),
    );
  });

  it("crea las reglas de negocio por defecto", async () => {
    const [row] = await database.db.select().from(settings);

    expect(row).toMatchObject({
      id: 1,
      bufferMinutes: 10,
      slotStepMinutes: 30,
      bookingMinDays: 2,
      bookingMaxMonths: 1,
      cancelMinHours: 2,
      rescheduleMinDays: 2,
    });
  });

  it("es idempotente y no pisa los cambios que haga Caro", async () => {
    await database.pool.query("UPDATE services SET price_cop = 45000 WHERE name = 'Retiro'");

    await seed(database.db);

    const all = await database.db.select().from(services);
    const retiro = all.find((service) => service.name === "Retiro");
    expect(all).toHaveLength(10);
    expect(retiro?.priceCop).toBe(45000);
    expect(await database.db.select().from(businessHours)).toHaveLength(6);
    expect(await database.db.select().from(settings)).toHaveLength(1);
  });
});
