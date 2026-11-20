import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createSession } from "../../src/auth/sessions.js";
import {
  appointments,
  appointmentServices,
  services,
  sessions,
  users,
} from "../../src/db/schema.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ db: database.db });
});

beforeEach(async () => {
  await database.pool.query(
    "TRUNCATE users, sessions, rate_limits, services, appointments, appointment_services CASCADE",
  );
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

// Crea una cuenta con sesión abierta y devuelve la cookie para las peticiones.
async function signedIn(role: "admin" | "client", phone: string) {
  const [user] = await database.db
    .insert(users)
    .values({
      name: role === "admin" ? "Caro Restrepo" : "Ana María",
      phone,
      passwordHash: "hash-de-prueba",
      role,
      consentAcceptedAt: new Date(),
    })
    .returning({ id: users.id });
  if (!user) throw new Error("No se creó la cuenta de prueba.");
  return { userId: user.id, cookie: `session=${await createSession(database.db, user.id)}` };
}

const asAdmin = () => signedIn("admin", "+573007445676");
const asClient = () => signedIn("client", "+573001234567");

async function insertService(values: Partial<typeof services.$inferInsert> = {}) {
  const [service] = await database.db
    .insert(services)
    .values({ name: "Retiro", priceCop: 15000, durationMinutes: 30, sortOrder: 1, ...values })
    .returning();
  if (!service) throw new Error("No se creó el servicio de prueba.");
  return service;
}

const newService = { name: "Manicure tradicional", priceCop: 25000, durationMinutes: 45 };

describe("permisos del panel de servicios", () => {
  it("sin sesión responde 401 en todas las rutas", async () => {
    const service = await insertService();
    const responses = await Promise.all([
      request(app).get("/api/admin/services"),
      request(app).post("/api/admin/services").send(newService),
      request(app).patch(`/api/admin/services/${service.id}`).send({ active: false }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "unauthorized" });
    }
    expect(await database.db.select().from(services)).toHaveLength(1);
  });

  it("un token inventado responde 401", async () => {
    const response = await request(app)
      .get("/api/admin/services")
      .set("Cookie", "session=token-inventado");
    expect(response.status).toBe(401);
  });

  it("una sesión de admin vencida responde 401", async () => {
    const { cookie } = await asAdmin();
    await database.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });

    const response = await request(app).get("/api/admin/services").set("Cookie", cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  // Igual que /me: si a la sesión le quedan menos de 15 días, se extiende y se reenvía.
  it("renueva la cookie de una sesión por vencer, también si responde 403", async () => {
    const admin = await asAdmin();
    const client = await asClient();
    await database.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) });

    const allowed = await request(app).get("/api/admin/services").set("Cookie", admin.cookie);
    const forbidden = await request(app).get("/api/admin/services").set("Cookie", client.cookie);

    expect(allowed.status).toBe(200);
    expect(forbidden.status).toBe(403);
    for (const [response, cookie] of [
      [allowed, admin.cookie],
      [forbidden, client.cookie],
    ] as const) {
      const sent = String(response.headers["set-cookie"]);
      expect(sent).toContain(`${cookie};`);
      expect(sent).toContain("Max-Age=2592000");
    }
  });

  it("no reenvía la cookie si la sesión todavía no está por vencer", async () => {
    const { cookie } = await asAdmin();
    const response = await request(app).get("/api/admin/services").set("Cookie", cookie);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("una clienta recibe 403 y no puede crear ni editar", async () => {
    const { cookie } = await asClient();
    const service = await insertService();
    const responses = await Promise.all([
      request(app).get("/api/admin/services").set("Cookie", cookie),
      request(app).post("/api/admin/services").set("Cookie", cookie).send(newService),
      request(app)
        .patch(`/api/admin/services/${service.id}`)
        .set("Cookie", cookie)
        .send({ priceCop: 1 }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "forbidden" });
    }
    const [unchanged] = await database.db.select().from(services);
    expect(unchanged?.priceCop).toBe(15000);
    expect(await database.db.select().from(services)).toHaveLength(1);
  });
});

describe("GET /api/admin/services", () => {
  it("lista todos los servicios, también los desactivados, en el orden de Caro", async () => {
    const { cookie } = await asAdmin();
    await insertService({
      name: "Retoque",
      priceCop: 60000,
      durationMinutes: 90,
      sortOrder: 2,
      active: false,
    });
    await insertService({ name: "Retiro", sortOrder: 1 });

    const response = await request(app).get("/api/admin/services").set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      services: [
        {
          id: expect.any(String),
          name: "Retiro",
          priceCop: 15000,
          durationMinutes: 30,
          active: true,
        },
        {
          id: expect.any(String),
          name: "Retoque",
          priceCop: 60000,
          durationMinutes: 90,
          active: false,
        },
      ],
    });
  });
});

describe("POST /api/admin/services", () => {
  it("crea el servicio al final del catálogo y aparece en el catálogo público", async () => {
    const { cookie } = await asAdmin();
    await insertService({ name: "Retiro", sortOrder: 7 });

    const response = await request(app)
      .post("/api/admin/services")
      .set("Cookie", cookie)
      .send({ ...newService, name: "  Manicure tradicional  " });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      service: { id: expect.any(String), ...newService, active: true },
    });
    const [created] = await database.db
      .select()
      .from(services)
      .where(eq(services.name, "Manicure tradicional"));
    expect(created?.sortOrder).toBe(8);

    const catalog = await request(app).get("/api/services");
    expect(catalog.body.services.map((service: { name: string }) => service.name)).toEqual([
      "Retiro",
      "Manicure tradicional",
    ]);
  });

  it("el primer servicio queda con orden 1", async () => {
    const { cookie } = await asAdmin();
    await request(app).post("/api/admin/services").set("Cookie", cookie).send(newService);
    const [created] = await database.db.select().from(services);
    expect(created?.sortOrder).toBe(1);
  });

  it("rechaza datos inválidos con un mensaje por campo y no guarda nada", async () => {
    const { cookie } = await asAdmin();

    const response = await request(app)
      .post("/api/admin/services")
      .set("Cookie", cookie)
      .send({ name: "A", priceCop: 2000001, durationMinutes: 32 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_input",
      fields: {
        name: "El nombre debe tener entre 2 y 60 caracteres.",
        priceCop: "El precio debe ser un número entero entre 0 y 2.000.000.",
        durationMinutes: "La duración debe ser múltiplo de 5 minutos.",
      },
    });
    expect(await database.db.select().from(services)).toHaveLength(0);
  });

  it("no permite dos servicios con el mismo nombre", async () => {
    const { cookie } = await asAdmin();
    await insertService({ name: "Retiro" });

    const response = await request(app)
      .post("/api/admin/services")
      .set("Cookie", cookie)
      .send({ ...newService, name: "Retiro" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "name_taken",
      fields: { name: "Ya existe un servicio con ese nombre." },
    });
    expect(await database.db.select().from(services)).toHaveLength(1);
  });
});

describe("nombres sin distinguir mayúsculas", () => {
  it("no permite crear un servicio que solo cambia mayúsculas", async () => {
    const { cookie } = await asAdmin();
    await insertService({ name: "Retiro" });

    for (const name of ["retiro", "RETIRO", "  rEtIrO  "]) {
      const response = await request(app)
        .post("/api/admin/services")
        .set("Cookie", cookie)
        .send({ ...newService, name });
      expect(response.status).toBe(409);
      expect(response.body.error).toBe("name_taken");
    }
    expect(await database.db.select().from(services)).toHaveLength(1);
  });

  it("no permite renombrar a otro servicio cambiando solo mayúsculas", async () => {
    const { cookie } = await asAdmin();
    await insertService({ name: "Retoque", sortOrder: 2 });
    const service = await insertService({ name: "Retiro" });

    const response = await request(app)
      .patch(`/api/admin/services/${service.id}`)
      .set("Cookie", cookie)
      .send({ name: "retoque" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("name_taken");
  });

  it("sí permite corregir las mayúsculas del propio servicio", async () => {
    const { cookie } = await asAdmin();
    const service = await insertService({ name: "retiro" });

    const response = await request(app)
      .patch(`/api/admin/services/${service.id}`)
      .set("Cookie", cookie)
      .send({ name: "Retiro" });

    expect(response.status).toBe(200);
    expect(response.body.service.name).toBe("Retiro");
  });
});

describe("PATCH /api/admin/services/:id", () => {
  it("edita nombre, precio y duración", async () => {
    const { cookie } = await asAdmin();
    // Fecha vieja a propósito: así la comparación no depende de los milisegundos.
    const service = await insertService({ updatedAt: new Date("2026-01-01T00:00:00Z") });

    const response = await request(app)
      .patch(`/api/admin/services/${service.id}`)
      .set("Cookie", cookie)
      .send({ name: "Retiro de esmalte", priceCop: 18000, durationMinutes: 35 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      service: {
        id: service.id,
        name: "Retiro de esmalte",
        priceCop: 18000,
        durationMinutes: 35,
        active: true,
      },
    });
    const [saved] = await database.db.select().from(services);
    expect(saved?.sortOrder).toBe(service.sortOrder);
    expect(saved?.updatedAt.getTime()).toBeGreaterThan(service.updatedAt.getTime());
  });

  it("desactivar lo saca del catálogo público y lo deja en el panel; activar lo devuelve", async () => {
    const { cookie } = await asAdmin();
    const service = await insertService();
    const publicNames = async () =>
      (await request(app).get("/api/services")).body.services.map((s: { name: string }) => s.name);

    const off = await request(app)
      .patch(`/api/admin/services/${service.id}`)
      .set("Cookie", cookie)
      .send({ active: false });
    expect(off.body.service.active).toBe(false);
    expect(await publicNames()).toEqual([]);
    const panel = await request(app).get("/api/admin/services").set("Cookie", cookie);
    expect(panel.body.services).toHaveLength(1);

    await request(app)
      .patch(`/api/admin/services/${service.id}`)
      .set("Cookie", cookie)
      .send({ active: true });
    expect(await publicNames()).toEqual(["Retiro"]);
  });

  it("cambiar el precio o la duración no cambia las citas ya reservadas", async () => {
    const { cookie } = await asAdmin();
    const { userId } = await asClient();
    const service = await insertService({ priceCop: 15000, durationMinutes: 30 });
    const [appointment] = await database.db
      .insert(appointments)
      .values({
        clientId: userId,
        startAt: new Date("2026-12-18T14:00:00Z"),
        endAt: new Date("2026-12-18T14:30:00Z"),
        occupiedUntil: new Date("2026-12-18T14:40:00Z"),
        totalPriceCop: 15000,
        createdBy: "client",
      })
      .returning({ id: appointments.id });
    if (!appointment) throw new Error("No se creó la cita de prueba.");
    await database.db.insert(appointmentServices).values({
      appointmentId: appointment.id,
      serviceId: service.id,
      serviceName: "Retiro",
      priceCop: 15000,
      durationMinutes: 30,
    });

    await request(app)
      .patch(`/api/admin/services/${service.id}`)
      .set("Cookie", cookie)
      .send({ name: "Retiro express", priceCop: 20000, durationMinutes: 20 });

    const [copy] = await database.db.select().from(appointmentServices);
    expect(copy).toMatchObject({ serviceName: "Retiro", priceCop: 15000, durationMinutes: 30 });
    const [booked] = await database.db.select().from(appointments);
    expect(booked?.totalPriceCop).toBe(15000);
  });

  it("rechaza datos inválidos y un cambio vacío", async () => {
    const { cookie } = await asAdmin();
    const service = await insertService();

    const invalid = await request(app)
      .patch(`/api/admin/services/${service.id}`)
      .set("Cookie", cookie)
      .send({ durationMinutes: 500 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.fields).toEqual({
      durationMinutes: "La duración debe estar entre 5 y 480 minutos.",
    });

    const empty = await request(app)
      .patch(`/api/admin/services/${service.id}`)
      .set("Cookie", cookie)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body).toEqual({
      error: "invalid_input",
      fields: { form: "No hay cambios para guardar." },
    });

    const [unchanged] = await database.db.select().from(services);
    expect(unchanged?.durationMinutes).toBe(30);
  });

  it("no permite renombrar a un nombre que ya existe", async () => {
    const { cookie } = await asAdmin();
    await insertService({ name: "Retoque", sortOrder: 2 });
    const service = await insertService({ name: "Retiro" });

    const response = await request(app)
      .patch(`/api/admin/services/${service.id}`)
      .set("Cookie", cookie)
      .send({ name: "Retoque" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("name_taken");
  });

  it("responde 404 si el servicio no existe o el id no es válido", async () => {
    const { cookie } = await asAdmin();

    for (const id of ["00000000-0000-4000-8000-000000000000", "no-es-un-id"]) {
      const response = await request(app)
        .patch(`/api/admin/services/${id}`)
        .set("Cookie", cookie)
        .send({ active: false });
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not_found" });
    }
  });
});

// Antes se descartaban sin avisar: el alta respondía 201 y el servicio quedaba activo.
describe("campos desconocidos", () => {
  it("el alta los rechaza con 400 y no guarda nada", async () => {
    const { cookie } = await asAdmin();

    const response = await request(app)
      .post("/api/admin/services")
      .set("Cookie", cookie)
      .send({ ...newService, active: false, sortOrder: 7 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_input",
      fields: { form: "No se aceptan estos campos: active, sortOrder." },
    });
    expect(await database.db.select().from(services)).toEqual([]);
  });

  it("la edición los rechaza con 400 y no cambia nada", async () => {
    const { cookie } = await asAdmin();
    const service = await insertService();

    const response = await request(app)
      .patch(`/api/admin/services/${service.id}`)
      .set("Cookie", cookie)
      .send({ priceCop: 20000, sortOrder: 1 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_input",
      fields: { form: "No se aceptan estos campos: sortOrder." },
    });
    const [unchanged] = await database.db.select().from(services);
    expect(unchanged?.priceCop).toBe(15000);
  });
});
