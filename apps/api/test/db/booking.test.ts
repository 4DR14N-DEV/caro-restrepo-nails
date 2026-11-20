import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { bogotaInstant } from "../../src/booking/dates.js";
import { appointments, scheduleExceptions, services, users } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

// Hoy, para los tests: viernes 20 de noviembre de 2026, 10:00 en Bogotá.
const now = () => new Date("2026-11-20T15:00:00Z");

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ db: database.db, now });
});

beforeEach(async () => {
  await database.pool.query(
    "TRUNCATE users, services, appointments, appointment_services, business_hours, schedule_exceptions, settings CASCADE",
  );
  // Horario de lunes a sábado de 9:00 a 19:00, reglas por defecto y el catálogo real.
  await seed(database.db);
});

afterAll(async () => {
  await database.pool.end();
});

async function serviceId(name: string): Promise<string> {
  const [service] = await database.db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.name, name));
  if (!service) throw new Error(`No existe el servicio ${name}.`);
  return service.id;
}

async function book(date: string, from: string, until: string, values = {}) {
  const [client] = await database.db
    .insert(users)
    .values({
      name: "Ana María",
      phone: `+57300${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      passwordHash: "hash-de-prueba",
      consentAcceptedAt: new Date(),
    })
    .returning({ id: users.id });
  if (!client) throw new Error("No se creó la clienta de prueba.");
  const startAt = bogotaInstant(date, from);
  const occupiedUntil = bogotaInstant(date, until);
  await database.db.insert(appointments).values({
    clientId: client.id,
    startAt,
    endAt: new Date(occupiedUntil.getTime() - 10 * 60_000),
    occupiedUntil,
    totalPriceCop: 40000,
    createdBy: "client",
    ...values,
  });
}

describe("GET /api/booking/days", () => {
  it("lista los días hábiles de la ventana: sin domingos ni festivos", async () => {
    const response = await request(app).get("/api/booking/days");

    expect(response.status).toBe(200);
    const days: string[] = response.body.days;
    // El 22 es domingo; el 20 de diciembre, también.
    expect(days[0]).toBe("2026-11-23");
    expect(days.at(-1)).toBe("2026-12-19");
    expect(days).not.toContain("2026-11-29");
    expect(days).not.toContain("2026-12-08");
    // Lunes a sábado del 23 de noviembre al 19 de diciembre, menos el 8 de diciembre.
    expect(days).toHaveLength(23);
  });

  it("quita un día bloqueado entero y suma un domingo con apertura extra", async () => {
    await database.db.insert(scheduleExceptions).values([
      {
        kind: "block",
        startsAt: bogotaInstant("2026-11-24", "00:00"),
        endsAt: bogotaInstant("2026-11-25", "00:00"),
      },
      {
        kind: "extra_open",
        startsAt: bogotaInstant("2026-11-29", "10:00"),
        endsAt: bogotaInstant("2026-11-29", "12:00"),
      },
    ]);

    const { body } = await request(app).get("/api/booking/days");
    expect(body.days).not.toContain("2026-11-24");
    expect(body.days).toContain("2026-11-29");
  });
});

describe("GET /api/booking/times", () => {
  const times = (date: string, ids: string[]) =>
    request(app)
      .get("/api/booking/times")
      .query({ date, services: ids.join(",") });

  it("ofrece las horas en las que entra la suma de los servicios elegidos", async () => {
    const manos = await serviceId("Semipermanente manos"); // 60 min
    const retiro = await serviceId("Retiro"); // 30 min

    const one = await times("2026-11-23", [manos]);
    expect(one.status).toBe(200);
    expect(one.body.times[0]).toBe("09:00");
    expect(one.body.times.at(-1)).toBe("18:00");
    expect(one.body.times).toHaveLength(19);

    const both = await times("2026-11-23", [manos, retiro]);
    expect(both.body.times.at(-1)).toBe("17:30");
  });

  it("no choca con las citas agendadas; las canceladas no ocupan la agenda", async () => {
    const manos = await serviceId("Semipermanente manos");
    await book("2026-11-23", "10:00", "11:10");
    await book("2026-11-23", "15:00", "16:10", {
      status: "cancelled",
      cancelledBy: "client",
      cancelledAt: new Date(),
    });

    const { body } = await times("2026-11-23", [manos]);
    expect(body.times).not.toContain("09:00");
    expect(body.times).toContain("11:10");
    expect(body.times).toContain("15:00");
  });

  it("fuera de la ventana, un domingo o un festivo no hay horas", async () => {
    const manos = await serviceId("Semipermanente manos");
    for (const date of ["2026-11-21", "2026-12-21", "2026-11-29", "2026-12-08"]) {
      const response = await times(date, [manos]);
      expect(response.status).toBe(200);
      expect(response.body.times).toEqual([]);
    }
  });

  it("rechaza una fecha o unos servicios inválidos con un mensaje por campo", async () => {
    const manos = await serviceId("Semipermanente manos");
    const cases = [
      [{ services: manos }, { date: "Elige una fecha válida." }],
      [{ date: "2026-02-30", services: manos }, { date: "Elige una fecha válida." }],
      [{ date: "2026-11-23" }, { services: "Elige al menos un servicio." }],
      [
        { date: "2026-11-23", services: "no-es-un-id" },
        { services: "Elige al menos un servicio." },
      ],
      [
        { date: "2026-11-23", services: `${manos},${manos}` },
        { services: "No repitas servicios." },
      ],
    ] as const;

    for (const [query, fields] of cases) {
      const response = await request(app).get("/api/booking/times").query(query);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_input", fields });
    }
  });

  it("responde 409 si algún servicio no existe o está desactivado", async () => {
    const manos = await serviceId("Semipermanente manos");
    const retiro = await serviceId("Retiro");
    await database.db.update(services).set({ active: false }).where(eq(services.id, retiro));

    for (const ids of [
      [manos, retiro],
      [manos, "00000000-0000-4000-8000-000000000000"],
    ]) {
      const response = await times("2026-11-23", ids);
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "service_unavailable",
        fields: { services: "Alguno de los servicios ya no está disponible. Vuelve a elegirlos." },
      });
    }
  });
});
