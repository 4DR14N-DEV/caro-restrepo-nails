import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/auth/password.js";
import { createSession } from "../../src/auth/sessions.js";
import { appointments, rateLimits, sessions, users } from "../../src/db/schema.js";
import { seed } from "../../src/db/seed-data.js";
import { appointmentHelpers, cancelledValues } from "./appointment-helpers.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

// Hoy, para los tests: lunes 23 de noviembre de 2026, 10:00 en Bogotá (UTC−5).
const now = () => new Date("2026-11-23T15:00:00Z");
const PHONE = "+573001234567";
const CURRENT = "clave-actual-1";

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ db: database.db, now, clientIp: () => "203.0.113.1" });
});

beforeEach(async () => {
  await database.pool.query(
    "TRUNCATE users, sessions, services, appointments, appointment_services, business_hours, schedule_exceptions, settings, rate_limits CASCADE",
  );
  await seed(database.db);
});

afterAll(async () => {
  await database.pool.end();
});

const { signedIn, service, appointment, waitForBlocked } = appointmentHelpers(() => database);

// Una clienta con contraseña real y dos sesiones abiertas.
async function client() {
  const [user] = await database.db
    .insert(users)
    .values({
      name: "Ana María",
      phone: PHONE,
      passwordHash: await hashPassword(CURRENT),
      consentAcceptedAt: new Date(),
    })
    .returning({ id: users.id });
  if (!user) throw new Error("No se creó la clienta.");
  const here = `session=${await createSession(database.db, user.id)}`;
  await createSession(database.db, user.id);
  return { id: user.id, here };
}

const remove = (cookie: string, body: object) =>
  request(app).post("/api/auth/account/delete").set("Cookie", cookie).send(body);

const userRow = async (id: string) => {
  const [row] = await database.db.select().from(users).where(eq(users.id, id));
  return row;
};

const statusOf = async (id: string) => {
  const [row] = await database.db
    .select({ status: appointments.status, cancelledBy: appointments.cancelledBy })
    .from(appointments)
    .where(eq(appointments.id, id));
  return row;
};

describe("POST /api/auth/account/delete", () => {
  it("sin sesión 401; la cuenta de Caro no se borra (403)", async () => {
    expect(
      (await request(app).post("/api/auth/account/delete").send({ currentPassword: CURRENT }))
        .status,
    ).toBe(401);
    const caro = await signedIn("+573007445676", "Caro Restrepo", "admin");
    const response = await remove(caro.cookie, { currentPassword: "hash-de-prueba" });
    expect(response.status).toBe(403);
    expect((await userRow(caro.userId))?.anonymizedAt).toBeNull();
  });

  it("anonimiza la cuenta, cierra las sesiones, cancela las próximas y conserva las pasadas", async () => {
    const ana = await client();
    const caro = await signedIn("+573007445676", "Caro Restrepo", "admin");
    // Pasada (sábado 21) y completada; próxima agendada (miércoles 25); próxima ya cancelada.
    const past = await appointment(ana.id, "2026-11-21T15:00:00Z", ["Semipermanente manos"], {
      status: "completed",
    });
    const upcoming = await appointment(ana.id, "2026-11-25T15:00:00Z", ["Semipermanente manos"]);
    const cancelled = await appointment(
      ana.id,
      "2026-11-26T15:00:00Z",
      ["Semipermanente manos"],
      cancelledValues,
    );
    // Un fallo de ingreso previo deja una fila con su celular.
    expect(
      (await request(app).post("/api/auth/login").send({ phone: "3001234567", password: "mala" }))
        .status,
    ).toBe(401);

    const response = await remove(ana.here, { currentPassword: CURRENT });
    expect(response.status).toBe(204);
    expect(String(response.headers["set-cookie"])).toMatch(/session=;.*Expires=Thu, 01 Jan 1970/);

    const row = await userRow(ana.id);
    expect(row).toMatchObject({ name: "Clienta eliminada", phone: null, passwordHash: null });
    expect(row?.anonymizedAt).toBeInstanceOf(Date);
    expect(await database.db.select().from(sessions).where(eq(sessions.userId, ana.id))).toEqual(
      [],
    );
    expect(
      await database.db
        .select()
        .from(rateLimits)
        .where(eq(rateLimits.key, `login-phone:${PHONE}`)),
    ).toEqual([]);

    expect(await statusOf(past)).toEqual({ status: "completed", cancelledBy: null });
    expect(await statusOf(upcoming)).toEqual({ status: "cancelled", cancelledBy: "client" });
    expect(await statusOf(cancelled)).toEqual({ status: "cancelled", cancelledBy: "client" });

    // Caro ve la cita pasada sin los datos de la clienta.
    const agenda = await request(app)
      .get("/api/admin/agenda")
      .query({ from: "2026-11-21", to: "2026-11-21" })
      .set("Cookie", caro.cookie);
    expect(agenda.body.appointments[0].client).toEqual({
      id: ana.id,
      name: "Clienta eliminada",
      phone: null,
    });

    // Ya no entra ni con la cookie ni con su contraseña.
    expect((await request(app).get("/api/auth/me").set("Cookie", ana.here)).status).toBe(401);
    expect(
      (await request(app).post("/api/auth/login").send({ phone: "3001234567", password: CURRENT }))
        .status,
    ).toBe(401);
  });

  it("ese celular puede volver a registrarse como una cuenta nueva", async () => {
    const ana = await client();
    expect((await remove(ana.here, { currentPassword: CURRENT })).status).toBe(204);

    const again = await request(app).post("/api/auth/register").send({
      name: "Ana María",
      phone: "3001234567",
      password: "otra-clave-3",
      consent: true,
    });
    expect(again.status).toBe(201);
    expect(again.body.user.id).not.toBe(ana.id);
  });

  it("con la contraseña incorrecta no borra nada y cuenta como ingreso fallido", async () => {
    const ana = await client();
    const upcoming = await appointment(ana.id, "2026-11-25T15:00:00Z", ["Semipermanente manos"]);

    const response = await remove(ana.here, { currentPassword: "mala-clave" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "wrong_password",
      fields: { currentPassword: "La contraseña actual no es correcta." },
    });
    expect((await userRow(ana.id))?.phone).toBe(PHONE);
    expect(await statusOf(upcoming)).toEqual({ status: "scheduled", cancelledBy: null });

    for (let i = 0; i < 4; i++) await remove(ana.here, { currentPassword: "mala-clave" });
    expect((await remove(ana.here, { currentPassword: CURRENT })).status).toBe(429);
    expect((await userRow(ana.id))?.phone).toBe(PHONE);
  });

  it("sin la contraseña responde 400 y no cuenta como intento", async () => {
    const ana = await client();
    const response = await remove(ana.here, {});
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_input",
      fields: { currentPassword: "Escribe tu contraseña actual." },
    });
    expect(await database.db.select().from(rateLimits)).toEqual([]);
  });
});

// Dos dispositivos de la misma clienta a la vez. Una conexión aparte retiene las sesiones de
// la clienta: el borrado queda detenido después de bloquear su cuenta y antes de terminar,
// y mientras tanto llega el otro pedido.
describe("borrar la cuenta mientras llega otro pedido", () => {
  async function whileDeleting<T>(
    userId: string,
    cookie: string,
    other: () => Promise<T>,
    blockedQuery: string,
  ) {
    const holder = await database.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM sessions WHERE user_id = $1 FOR UPDATE", [userId]);
      const deleting = remove(cookie, { currentPassword: CURRENT }).then((r) => r);
      await waitForBlocked('delete from "sessions"');
      const pending = other();
      await waitForBlocked(blockedQuery);
      await holder.query("COMMIT");
      return await Promise.all([deleting, pending]);
    } finally {
      holder.release();
    }
  }

  const scheduledOf = async (id: string) =>
    (await database.db.select().from(appointments).where(eq(appointments.clientId, id))).filter(
      (row) => row.status === "scheduled",
    );

  it("una reserva de la clienta no queda agendada en la cuenta borrada", async () => {
    const ana = await client();
    const other = `session=${await createSession(database.db, ana.id)}`;
    const manos = await service("Semipermanente manos");

    const [deleted, booked] = await whileDeleting(
      ana.id,
      ana.here,
      () =>
        request(app)
          .post("/api/appointments")
          .set("Cookie", other)
          .send({ serviceIds: [manos.id], date: "2026-11-25", time: "10:00" })
          .then((r) => r),
      'select "id" from "users"',
    );
    expect(deleted.status).toBe(204);
    expect(booked.status).toBe(401);
    expect(await scheduledOf(ana.id)).toEqual([]);
  });

  it("una cita que Caro agenda a su nombre no queda en la cuenta borrada", async () => {
    const ana = await client();
    const caro = await signedIn("+573007445676", "Caro Restrepo", "admin");
    const manos = await service("Semipermanente manos");

    const [deleted, created] = await whileDeleting(
      ana.id,
      ana.here,
      () =>
        request(app)
          .post("/api/admin/appointments")
          .set("Cookie", caro.cookie)
          .send({ clientId: ana.id, serviceIds: [manos.id], date: "2026-11-25", time: "10:00" })
          .then((r) => r),
      'select "id" from "users"',
    );
    expect(deleted.status).toBe(204);
    expect(created.status).toBe(409);
    expect(created.body.error).toBe("client_unavailable");
    expect(await scheduledOf(ana.id)).toEqual([]);
  });

  it("un cambio de contraseña no le deja contraseña a la cuenta borrada", async () => {
    const ana = await client();
    const other = `session=${await createSession(database.db, ana.id)}`;

    const [deleted, changed] = await whileDeleting(
      ana.id,
      ana.here,
      () =>
        request(app)
          .post("/api/auth/password")
          .set("Cookie", other)
          .send({ currentPassword: CURRENT, newPassword: "nueva-clave-2" })
          .then((r) => r),
      'update "users"',
    );
    expect(deleted.status).toBe(204);
    expect(changed.status).toBe(401);
    const row = await userRow(ana.id);
    expect(row?.anonymizedAt).toBeInstanceOf(Date);
    expect(row?.passwordHash).toBeNull();
  });
});
