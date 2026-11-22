import type { PushPayload } from "@caro/shared";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/auth/password.js";
import { appointments, pushSubscriptions, users } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import type { PushResult, PushService, PushTarget } from "../../src/push/sender.js";
import { appointmentHelpers } from "./appointment-helpers.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;

// Hoy, para los tests: viernes 20 de noviembre de 2026, 10:00 en Bogotá.
const now = () => new Date("2026-11-20T15:00:00Z");

// Servicio de push falso: guarda lo que se envió a cada dispositivo. `result` decide qué
// responde el servicio de push.
function fakePush(result: (target: PushTarget) => Promise<PushResult> = async () => "sent") {
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  const push: PushService = {
    publicKey: "clave-publica",
    send: vi.fn(async (target: PushTarget, payload: string) => {
      const outcome = await result(target);
      sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) as PushPayload });
      return outcome;
    }),
  };
  return { push, sent };
}

beforeAll(async () => {
  database = await createTestDatabase();
});

beforeEach(async () => {
  await database.pool.query(
    "TRUNCATE users, sessions, services, appointments, appointment_services, business_hours, schedule_exceptions, settings, rate_limits, push_subscriptions CASCADE",
  );
  await seed(database.db);
});

afterAll(async () => {
  await database.pool.end();
});

const { signedIn, service, appointment } = appointmentHelpers(() => database);

const CELULAR = "https://fcm.googleapis.com/fcm/send/celular";
const TABLET = "https://web.push.apple.com/tablet";

// Caro con dos dispositivos activados.
async function caroWithDevices() {
  const caro = await signedIn("+573007445676", "Caro Restrepo", "admin");
  await database.db.insert(pushSubscriptions).values([
    { userId: caro.userId, endpoint: CELULAR, p256dh: "p256dh-1", auth: "auth-1" },
    { userId: caro.userId, endpoint: TABLET, p256dh: "p256dh-2", auth: "auth-2" },
  ]);
  return caro;
}

const endpoints = async () =>
  (await database.db.select().from(pushSubscriptions)).map((row) => row.endpoint).sort();

describe("avisos push a Caro (RF18)", () => {
  it("al reservar una clienta, llega a cada dispositivo de Caro", async () => {
    const { push, sent } = fakePush();
    const app = createApp({ db: database.db, now, push });
    await caroWithDevices();
    const ana = await signedIn("+573001234567");
    const manos = await service("Semipermanente manos");

    const response = await request(app)
      .post("/api/appointments")
      .set("Cookie", ana.cookie)
      .send({ serviceIds: [manos.id], date: "2026-11-23", time: "10:00" });

    expect(response.status).toBe(201);
    expect(sent.map((item) => item.endpoint).sort()).toEqual([CELULAR, TABLET]);
    expect(sent[0]?.payload).toEqual({
      title: "Nueva cita",
      body: "Ana María, Semipermanente manos, lunes 23 de noviembre a las 10:00 a. m.",
      url: "/admin/agenda?dia=2026-11-23",
    });
    expect(push.send).toHaveBeenCalledWith(
      { endpoint: CELULAR, keys: { p256dh: "p256dh-1", auth: "auth-1" } },
      expect.any(String),
    );
  });

  it("al cancelar una clienta", async () => {
    const { push, sent } = fakePush();
    const app = createApp({ db: database.db, now, push });
    await caroWithDevices();
    const ana = await signedIn("+573001234567");
    const id = await appointment(ana.userId, "2026-11-24T18:30:00Z", ["Retiro"]); // martes 1:30 p. m.

    const response = await request(app)
      .post(`/api/appointments/${id}/cancel`)
      .set("Cookie", ana.cookie);

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.payload).toEqual({
      title: "Cita cancelada",
      body: "Ana María, Retiro, martes 24 de noviembre a la 1:30 p. m.",
      url: "/admin/agenda?dia=2026-11-24",
    });
  });

  it("al reprogramar una clienta: del día anterior al nuevo", async () => {
    const { push, sent } = fakePush();
    const app = createApp({ db: database.db, now, push });
    await caroWithDevices();
    const ana = await signedIn("+573001234567");
    const id = await appointment(ana.userId, "2026-11-30T15:00:00Z", ["Retiro"]); // lunes 10:00

    const response = await request(app)
      .patch(`/api/appointments/${id}`)
      .set("Cookie", ana.cookie)
      .send({ date: "2026-12-01", time: "11:00" });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.payload).toEqual({
      title: "Cita reprogramada",
      body: "Ana María, Retiro, del lunes 30 de noviembre a las 10:00 a. m. al martes 1 de diciembre a las 11:00 a. m.",
      url: "/admin/agenda?dia=2026-12-01",
    });
  });

  it("al borrar la cuenta: un aviso por cada cita próxima, con el nombre que tenía", async () => {
    const { push, sent } = fakePush();
    const app = createApp({ db: database.db, now, push });
    const caro = await signedIn("+573007445676", "Caro Restrepo", "admin");
    await database.db
      .insert(pushSubscriptions)
      .values({ userId: caro.userId, endpoint: CELULAR, p256dh: "p256dh-1", auth: "auth-1" });
    const ana = await signedIn("+573001234567");
    await database.db
      .update(users)
      .set({ passwordHash: await hashPassword("clave-actual-123") })
      .where(eq(users.id, ana.userId));
    await appointment(ana.userId, "2026-11-23T15:00:00Z", ["Retiro"]);
    await appointment(ana.userId, "2026-11-25T15:00:00Z", ["Semipermanente manos"]);
    await appointment(ana.userId, "2026-11-10T15:00:00Z", ["Retiro"]); // pasada: no avisa

    const response = await request(app)
      .post("/api/auth/account/delete")
      .set("Cookie", ana.cookie)
      .send({ currentPassword: "clave-actual-123" });

    expect(response.status).toBe(204);
    expect(sent.map((item) => item.payload).sort((a, b) => a.url.localeCompare(b.url))).toEqual([
      {
        title: "Cita cancelada",
        body: "Ana María, Retiro, lunes 23 de noviembre a las 10:00 a. m.",
        url: "/admin/agenda?dia=2026-11-23",
      },
      {
        title: "Cita cancelada",
        body: "Ana María, Semipermanente manos, miércoles 25 de noviembre a las 10:00 a. m.",
        url: "/admin/agenda?dia=2026-11-25",
      },
    ]);
  });

  it("lo que hace Caro desde el panel no la avisa", async () => {
    const { push, sent } = fakePush();
    const app = createApp({ db: database.db, now, push });
    const caro = await caroWithDevices();
    const ana = await signedIn("+573001234567");
    const retiro = await service("Retiro");

    const created = await request(app)
      .post("/api/admin/appointments")
      .set("Cookie", caro.cookie)
      .send({ clientId: ana.userId, serviceIds: [retiro.id], date: "2026-11-24", time: "10:00" });
    expect(created.status).toBe(201);
    const id = created.body.appointment.id as string;
    const cancelled = await request(app)
      .patch(`/api/admin/appointments/${id}/status`)
      .set("Cookie", caro.cookie)
      .send({ status: "cancelled" });
    expect(cancelled.status).toBe(200);

    expect(sent).toEqual([]);
  });

  it("las suscripciones de otras cuentas que ya no son admin no reciben nada", async () => {
    const { push, sent } = fakePush();
    const app = createApp({ db: database.db, now, push });
    await caroWithDevices();
    const ana = await signedIn("+573001234567");
    await database.db
      .insert(pushSubscriptions)
      .values({ userId: ana.userId, endpoint: "https://otra.example/x", p256dh: "a", auth: "b" });
    const manos = await service("Semipermanente manos");

    await request(app)
      .post("/api/appointments")
      .set("Cookie", ana.cookie)
      .send({ serviceIds: [manos.id], date: "2026-11-23", time: "10:00" });

    expect(sent.map((item) => item.endpoint).sort()).toEqual([CELULAR, TABLET]);
  });

  it("una suscripción vencida (404/410) se borra; las demás siguen", async () => {
    const { push } = fakePush(async (target) => (target.endpoint === TABLET ? "gone" : "sent"));
    const app = createApp({ db: database.db, now, push });
    await caroWithDevices();
    const ana = await signedIn("+573001234567");
    const manos = await service("Semipermanente manos");

    const response = await request(app)
      .post("/api/appointments")
      .set("Cookie", ana.cookie)
      .send({ serviceIds: [manos.id], date: "2026-11-23", time: "10:00" });

    expect(response.status).toBe(201);
    expect(await endpoints()).toEqual([CELULAR]);
  });

  it("si el envío falla, la reserva igual se guarda y responde 201", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { push } = fakePush(async () => {
      throw new Error("servicio de push caído");
    });
    const app = createApp({ db: database.db, now, push });
    await caroWithDevices();
    const ana = await signedIn("+573001234567");
    const manos = await service("Semipermanente manos");

    const response = await request(app)
      .post("/api/appointments")
      .set("Cookie", ana.cookie)
      .send({ serviceIds: [manos.id], date: "2026-11-23", time: "10:00" });

    expect(response.status).toBe(201);
    expect(await database.db.select().from(appointments)).toHaveLength(1);
    expect(await endpoints()).toEqual([CELULAR, TABLET]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
