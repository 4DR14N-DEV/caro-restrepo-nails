import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { services } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { appointmentHelpers, cancelledValues as cancelled } from "./appointment-helpers.js";
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
    "TRUNCATE users, sessions, services, appointments, appointment_services, business_hours, settings CASCADE",
  );
  await seed(database.db);
});

afterAll(async () => {
  await database.pool.end();
});

const { signedIn, appointment } = appointmentHelpers(() => database);

describe("GET /api/appointments", () => {
  it("sin sesión responde 401", async () => {
    const response = await request(app).get("/api/appointments");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("sin citas devuelve las dos listas vacías", async () => {
    const { cookie } = await signedIn("+573001234567");
    const response = await request(app).get("/api/appointments").set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ upcoming: [], history: [] });
    // Son datos personales: el navegador ni ningún intermediario los guarda.
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("separa las próximas del historial, cada una en su orden y con su estado", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    // Próximas: agendadas que todavía no empiezan.
    const tuesday = await appointment(userId, "2026-11-24T15:00:00Z", ["Retiro"]);
    const monday = await appointment(userId, "2026-11-23T14:00:00Z", [
      "Semipermanente manos",
      "Retiro",
    ]);
    // Historial.
    const pastScheduled = await appointment(userId, "2026-11-19T15:00:00Z", ["Retiro"]);
    const done = await appointment(userId, "2026-11-10T15:00:00Z", ["Retiro"], {
      status: "completed",
    });
    const missed = await appointment(userId, "2026-11-12T15:00:00Z", ["Retiro"], {
      status: "no_show",
    });
    const futureCancelled = await appointment(
      userId,
      "2026-11-25T15:00:00Z",
      ["Retiro"],
      cancelled,
    );

    const { body } = await request(app).get("/api/appointments").set("Cookie", cookie);

    expect(body.upcoming).toEqual([
      {
        id: monday,
        date: "2026-11-23",
        time: "09:00",
        services: ["Retiro", "Semipermanente manos"],
        durationMinutes: 90,
        totalPriceCop: 55000,
        state: "upcoming",
        canCancel: true,
        canReschedule: true,
      },
      expect.objectContaining({ id: tuesday, date: "2026-11-24", time: "10:00" }),
    ]);
    expect(body.history.map((a: { id: string; state: string }) => [a.id, a.state])).toEqual([
      [futureCancelled, "cancelled"],
      [pastScheduled, "past"],
      [missed, "no_show"],
      [done, "completed"],
    ]);
  });

  it("una cita que ya empezó deja de ser próxima", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    // Empezó a las 9:30 en Bogotá; ahora son las 10:00.
    const started = await appointment(userId, "2026-11-20T14:30:00Z", ["Semipermanente manos"]);

    const { body } = await request(app).get("/api/appointments").set("Cookie", cookie);

    expect(body.upcoming).toEqual([]);
    expect(body.history).toEqual([expect.objectContaining({ id: started, state: "past" })]);
  });

  it("una cita que empieza justo ahora ya no es próxima", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    const exact = await appointment(userId, "2026-11-20T15:00:00Z", ["Retiro"]);

    const { body } = await request(app).get("/api/appointments").set("Cookie", cookie);

    expect(body.upcoming).toEqual([]);
    expect(body.history).toEqual([
      expect.objectContaining({ id: exact, state: "past", time: "10:00" }),
    ]);
  });

  it("los parámetros de la consulta no cambian de quién son las citas", async () => {
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");
    await appointment(luisa.userId, "2026-11-24T15:00:00Z", ["Retiro"]);

    const { body } = await request(app)
      .get(`/api/appointments?clientId=${luisa.userId}&userId=${luisa.userId}`)
      .set("Cookie", ana.cookie);

    expect(body).toEqual({ upcoming: [], history: [] });
  });

  it("muestra solo las citas propias", async () => {
    const ana = await signedIn("+573001234567");
    const luisa = await signedIn("+573009876543", "Luisa");
    const mine = await appointment(ana.userId, "2026-11-23T15:00:00Z", ["Retiro"]);
    await appointment(luisa.userId, "2026-11-24T15:00:00Z", ["Retiro"]);
    await appointment(luisa.userId, "2026-11-10T15:00:00Z", ["Retiro"], { status: "completed" });

    const { body } = await request(app).get("/api/appointments").set("Cookie", ana.cookie);

    expect(body.upcoming.map((a: { id: string }) => a.id)).toEqual([mine]);
    expect(body.history).toEqual([]);
  });

  it("muestra los precios del momento de la reserva aunque Caro los cambie", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    await appointment(userId, "2026-11-23T15:00:00Z", ["Retiro"]);
    await database.db
      .update(services)
      .set({ priceCop: 99000, durationMinutes: 120 })
      .where(eq(services.name, "Retiro"));

    const { body } = await request(app).get("/api/appointments").set("Cookie", cookie);

    expect(body.upcoming[0]).toMatchObject({ totalPriceCop: 15000, durationMinutes: 30 });
  });

  it("con dos citas a la misma hora (una cancelada y la que la reemplazó), va primero la más nueva", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    const first = await appointment(userId, "2026-11-19T15:00:00Z", ["Retiro"], cancelled);
    const second = await appointment(userId, "2026-11-19T15:00:00Z", ["Retiro"]);

    for (let attempt = 0; attempt < 3; attempt++) {
      const { body } = await request(app).get("/api/appointments").set("Cookie", cookie);
      expect(body.history.map((a: { id: string }) => a.id)).toEqual([second, first]);
    }
  });

  it("el historial muestra las últimas 20", async () => {
    const { userId, cookie } = await signedIn("+573001234567");
    for (let day = 1; day <= 22; day++) {
      const date = `2026-10-${String(day).padStart(2, "0")}`;
      await appointment(userId, `${date}T15:00:00Z`, ["Retiro"], { status: "completed" });
    }

    const { body } = await request(app).get("/api/appointments").set("Cookie", cookie);

    expect(body.history).toHaveLength(20);
    expect(body.history[0].date).toBe("2026-10-22");
    expect(body.history.at(-1).date).toBe("2026-10-03");
  });
});
