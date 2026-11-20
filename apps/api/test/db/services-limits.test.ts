import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createSession } from "../../src/auth/sessions.js";
import { appointments, appointmentServices, services, users } from "../../src/db/schema.js";
import { createTestDatabase } from "./helpers.js";

// S5 (RF16) y S3: permisos, límites de cada campo, nombre único, orden y catálogo público.

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

async function signedIn(role: "admin" | "client", phone: string) {
  const [user] = await database.db
    .insert(users)
    .values({ name: "Prueba", phone, passwordHash: "x", role, consentAcceptedAt: new Date() })
    .returning({ id: users.id });
  if (!user) throw new Error("No se creó la cuenta de prueba.");
  return { userId: user.id, cookie: `session=${await createSession(database.db, user.id)}` };
}

// Huella de las tablas que el panel podría tocar: debe quedar igual si se rechaza algo.
async function fingerprint(): Promise<string> {
  const { rows } = await database.pool.query<{ hash: string }>(`
    SELECT md5(
      coalesce((SELECT string_agg(s::text, '|' ORDER BY id) FROM services s), '') ||
      coalesce((SELECT string_agg(a::text, '|' ORDER BY appointment_id) FROM appointment_services a), '')
    ) AS hash`);
  return rows[0]?.hash ?? "";
}

async function seedTwo() {
  return database.db
    .insert(services)
    .values([
      { name: "Retiro", priceCop: 15000, durationMinutes: 30, sortOrder: 1 },
      { name: "Press on", priceCop: 80000, durationMinutes: 120, sortOrder: 2 },
    ])
    .returning();
}

const valid = { name: "Manicure tradicional", priceCop: 25000, durationMinutes: 45 };
const NAME = "El nombre debe tener entre 2 y 60 caracteres.";
const PRICE = "El precio debe ser un número entero entre 0 y 2.000.000.";
const DURATION = "La duración debe estar entre 5 y 480 minutos.";
const STEP = "La duración debe ser múltiplo de 5 minutos.";

describe("permisos (S5)", () => {
  it("rechaza sin sesión, con token inventado y con sesión vencida, sin escribir nada", async () => {
    const [service] = await seedTwo();
    const { userId } = await signedIn("admin", "+573007445676");
    const expired = await createSession(database.db, userId);
    await database.pool.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
    const before = await fingerprint();

    for (const cookie of [undefined, "session=inventado", `session=${expired}`]) {
      const calls = [
        request(app).get("/api/admin/services"),
        request(app).post("/api/admin/services"),
        request(app).patch(`/api/admin/services/${service?.id}`),
        request(app).patch("/api/admin/services/no-es-un-id"),
      ].map((call) => (cookie ? call.set("Cookie", cookie) : call));
      const responses = await Promise.all(
        calls.map((call, i) => (i === 0 ? call : call.send({ ...valid, active: false }))),
      );
      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: "unauthorized" });
      }
    }
    expect(await fingerprint()).toBe(before);
  });

  it("responde 403 a una clienta en GET, POST y PATCH y no escribe nada", async () => {
    const [service] = await seedTwo();
    const { cookie } = await signedIn("client", "+573001234567");
    const before = await fingerprint();

    const responses = [
      await request(app).get("/api/admin/services").set("Cookie", cookie),
      await request(app).post("/api/admin/services").set("Cookie", cookie).send(valid),
      await request(app)
        .patch(`/api/admin/services/${service?.id}`)
        .set("Cookie", cookie)
        .send({ active: false, priceCop: 1 }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "forbidden" });
    }
    expect(await fingerprint()).toBe(before);
  });
});

describe("límites de los campos (S5)", () => {
  const cases: [string, object, number, Record<string, string> | null][] = [
    ["nombre de 2 tras recortar", { name: "  ab  " }, 201, null],
    ["nombre de 1 tras recortar", { name: "  a  " }, 400, { name: NAME }],
    ["nombre de 60", { name: "n".repeat(60) }, 201, null],
    ["nombre de 61", { name: "n".repeat(61) }, 400, { name: NAME }],
    ["precio 0", { priceCop: 0 }, 201, null],
    ["precio 2.000.000", { priceCop: 2_000_000 }, 201, null],
    ["precio 2.000.001", { priceCop: 2_000_001 }, 400, { priceCop: PRICE }],
    ["precio negativo", { priceCop: -1 }, 400, { priceCop: PRICE }],
    ["precio con decimales", { priceCop: 1500.5 }, 400, { priceCop: PRICE }],
    ["precio como texto", { priceCop: "25000" }, 400, { priceCop: PRICE }],
    ["duración 0", { durationMinutes: 0 }, 400, { durationMinutes: DURATION }],
    ["duración 5", { durationMinutes: 5 }, 201, null],
    ["duración 480", { durationMinutes: 480 }, 201, null],
    ["duración 485", { durationMinutes: 485 }, 400, { durationMinutes: DURATION }],
    ["duración 32", { durationMinutes: 32 }, 400, { durationMinutes: STEP }],
    ["duración como texto", { durationMinutes: "45" }, 400, { durationMinutes: DURATION }],
  ];

  for (const [label, override, status, fields] of cases) {
    it(`al crear: ${label}`, async () => {
      const { cookie } = await signedIn("admin", "+573007445676");
      const before = await fingerprint();
      const response = await request(app)
        .post("/api/admin/services")
        .set("Cookie", cookie)
        .send({ ...valid, ...override });

      expect(response.status).toBe(status);
      if (fields) {
        expect(response.body).toEqual({ error: "invalid_input", fields });
        expect(await fingerprint()).toBe(before);
      }
    });

    it(`al editar: ${label}`, async () => {
      const { cookie } = await signedIn("admin", "+573007445676");
      const [service] = await seedTwo();
      const before = await fingerprint();
      const response = await request(app)
        .patch(`/api/admin/services/${service?.id}`)
        .set("Cookie", cookie)
        .send(override);

      expect(response.status).toBe(status === 201 ? 200 : status);
      if (fields) {
        expect(response.body).toEqual({ error: "invalid_input", fields });
        expect(await fingerprint()).toBe(before);
      }
    });
  }

  it("recorta el nombre antes de guardarlo", async () => {
    const { cookie } = await signedIn("admin", "+573007445676");
    const response = await request(app)
      .post("/api/admin/services")
      .set("Cookie", cookie)
      .send({ ...valid, name: "  Manicure  " });
    expect(response.body.service.name).toBe("Manicure");
  });
});

describe("nombre único, ids y orden (S5)", () => {
  it("409 al crear con un nombre repetido, también con espacios alrededor", async () => {
    const { cookie } = await signedIn("admin", "+573007445676");
    await seedTwo();
    const before = await fingerprint();

    for (const name of ["Retiro", "  Retiro "]) {
      const response = await request(app)
        .post("/api/admin/services")
        .set("Cookie", cookie)
        .send({ ...valid, name });
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "name_taken",
        fields: { name: "Ya existe un servicio con ese nombre." },
      });
    }
    expect(await fingerprint()).toBe(before);
  });

  it("409 al renombrar a otro existente; 200 al guardar el mismo nombre", async () => {
    const { cookie } = await signedIn("admin", "+573007445676");
    const [retiro] = await seedTwo();
    const before = await fingerprint();

    const taken = await request(app)
      .patch(`/api/admin/services/${retiro?.id}`)
      .set("Cookie", cookie)
      .send({ name: "Press on" });
    expect(taken.status).toBe(409);
    expect(await fingerprint()).toBe(before);

    const same = await request(app)
      .patch(`/api/admin/services/${retiro?.id}`)
      .set("Cookie", cookie)
      .send({ name: "Retiro" });
    expect(same.status).toBe(200);
  });

  it("404 para un id inexistente o mal formado, sin escribir nada", async () => {
    const { cookie } = await signedIn("admin", "+573007445676");
    await seedTwo();
    const before = await fingerprint();

    for (const id of ["00000000-0000-4000-8000-000000000000", "abc", "1", "' OR 1=1 --"]) {
      const response = await request(app)
        .patch(`/api/admin/services/${encodeURIComponent(id)}`)
        .set("Cookie", cookie)
        .send({ active: false });
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not_found" });
    }
    expect(await fingerprint()).toBe(before);
  });

  it("un cambio vacío o con campos desconocidos responde 400 y no escribe", async () => {
    const { cookie } = await signedIn("admin", "+573007445676");
    const [service] = await seedTwo();
    const before = await fingerprint();

    for (const body of [{}, { sortOrder: 99 }, { id: "otro" }]) {
      const response = await request(app)
        .patch(`/api/admin/services/${service?.id}`)
        .set("Cookie", cookie)
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "invalid_input",
        fields: { form: "No hay cambios para guardar." },
      });
    }
    expect(await fingerprint()).toBe(before);
  });

  it("un servicio nuevo va al final, detrás también de los inactivos", async () => {
    const { cookie } = await signedIn("admin", "+573007445676");
    await database.db.insert(services).values([
      { name: "Zeta", priceCop: 1000, durationMinutes: 30, sortOrder: 1 },
      { name: "Inactivo", priceCop: 1000, durationMinutes: 30, sortOrder: 7, active: false },
    ]);

    const created = await request(app)
      .post("/api/admin/services")
      .set("Cookie", cookie)
      .send({ ...valid, name: "Aaa" });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      service: {
        id: expect.any(String),
        name: "Aaa",
        priceCop: 25000,
        durationMinutes: 45,
        active: true,
      },
    });

    const publicList = await request(app).get("/api/services");
    expect(publicList.body.services.map((s: { name: string }) => s.name)).toEqual(["Zeta", "Aaa"]);
    const adminList = await request(app).get("/api/admin/services").set("Cookie", cookie);
    expect(
      adminList.body.services.map((s: { name: string; active: boolean }) => [s.name, s.active]),
    ).toEqual([
      ["Zeta", true],
      ["Inactivo", false],
      ["Aaa", true],
    ]);
  });

  it("desactivar oculta del catálogo público, no borra, y el panel lo sigue mostrando", async () => {
    const { cookie } = await signedIn("admin", "+573007445676");
    const [retiro] = await seedTwo();

    const off = await request(app)
      .patch(`/api/admin/services/${retiro?.id}`)
      .set("Cookie", cookie)
      .send({ active: false });
    expect(off.body.service).toMatchObject({ name: "Retiro", active: false });

    const publicList = await request(app).get("/api/services");
    expect(publicList.body).toEqual({
      services: [
        { id: expect.any(String), name: "Press on", priceCop: 80000, durationMinutes: 120 },
      ],
    });
    const { rows } = await database.pool.query("SELECT count(*)::int AS n FROM services");
    expect(rows[0].n).toBe(2);
    // No hay ruta para borrar.
    const del = await request(app)
      .delete(`/api/admin/services/${retiro?.id}`)
      .set("Cookie", cookie);
    expect(del.status).toBe(404);
    expect((await database.pool.query("SELECT count(*)::int AS n FROM services")).rows[0].n).toBe(
      2,
    );
  });

  it("editar no cambia las copias de las citas reservadas", async () => {
    const { cookie } = await signedIn("admin", "+573007445676");
    const { userId } = await signedIn("client", "+573001234567");
    const [retiro] = await seedTwo();
    if (!retiro) throw new Error("sin servicio");
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
    if (!appointment) throw new Error("sin cita");
    await database.db.insert(appointmentServices).values({
      appointmentId: appointment.id,
      serviceId: retiro.id,
      serviceName: "Retiro",
      priceCop: 15000,
      durationMinutes: 30,
    });
    const snapshot = async () =>
      (
        await database.pool.query(
          "SELECT md5((SELECT string_agg(s::text, '|') FROM appointment_services s) || (SELECT string_agg(a::text, '|') FROM appointments a)) AS h",
        )
      ).rows[0].h;
    const before = await snapshot();

    for (const body of [
      { priceCop: 99000 },
      { durationMinutes: 240 },
      { name: "Retiro nuevo" },
      { active: false },
    ]) {
      const response = await request(app)
        .patch(`/api/admin/services/${retiro.id}`)
        .set("Cookie", cookie)
        .send(body);
      expect(response.status).toBe(200);
    }
    expect(await snapshot()).toBe(before);
  });
});
