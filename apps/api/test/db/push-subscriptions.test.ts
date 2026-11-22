import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { pushSubscriptions } from "../../src/db/schema.js";
import type { PushService } from "../../src/push/sender.js";
import { appointmentHelpers } from "./appointment-helpers.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

const push: PushService = { publicKey: "clave-publica-de-prueba", send: async () => "sent" };

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ db: database.db, push });
});

beforeEach(async () => {
  await database.pool.query("TRUNCATE users, sessions, push_subscriptions CASCADE");
});

afterAll(async () => {
  await database.pool.end();
});

const { signedIn } = appointmentHelpers(() => database);
const asCaro = () => signedIn("+573007445676", "Caro Restrepo", "admin");

const subscription = (endpoint = "https://fcm.googleapis.com/fcm/send/abc123") => ({
  endpoint,
  expirationTime: null,
  keys: {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
});

const subscribe = (cookie: string, body: unknown) =>
  request(app)
    .put("/api/admin/push/subscription")
    .set("Cookie", cookie)
    .send(body as object);

const unsubscribe = (cookie: string, body: unknown) =>
  request(app)
    .post("/api/admin/push/subscription/delete")
    .set("Cookie", cookie)
    .send(body as object);

const rows = () => database.db.select().from(pushSubscriptions);

describe("GET /api/admin/push/key", () => {
  it("sin sesión 401; una clienta 403", async () => {
    const client = await signedIn("+573001234567");
    expect((await request(app).get("/api/admin/push/key")).status).toBe(401);
    expect(
      (await request(app).get("/api/admin/push/key").set("Cookie", client.cookie)).status,
    ).toBe(403);
  });

  it("devuelve la clave pública VAPID", async () => {
    const caro = await asCaro();
    const response = await request(app).get("/api/admin/push/key").set("Cookie", caro.cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ publicKey: "clave-publica-de-prueba" });
  });

  it("sin claves configuradas responde publicKey null", async () => {
    const withoutPush = createApp({ db: database.db });
    const caro = await asCaro();
    const response = await request(withoutPush)
      .get("/api/admin/push/key")
      .set("Cookie", caro.cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ publicKey: null });
  });
});

describe("PUT /api/admin/push/subscription", () => {
  it("sin sesión 401; una clienta 403 y no guarda nada", async () => {
    const client = await signedIn("+573001234567");
    expect(
      (await request(app).put("/api/admin/push/subscription").send(subscription())).status,
    ).toBe(401);
    expect((await subscribe(client.cookie, subscription())).status).toBe(403);
    expect(await rows()).toEqual([]);
  });

  it("guarda la suscripción de este dispositivo a nombre de Caro", async () => {
    const caro = await asCaro();
    const response = await subscribe(caro.cookie, subscription());
    expect(response.status).toBe(204);
    const saved = await rows();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      userId: caro.userId,
      endpoint: subscription().endpoint,
      p256dh: subscription().keys.p256dh,
      auth: subscription().keys.auth,
    });
  });

  it("varios dispositivos quedan activos a la vez; repetir el mismo actualiza sus claves", async () => {
    const caro = await asCaro();
    await subscribe(caro.cookie, subscription("https://fcm.googleapis.com/fcm/send/celular"));
    await subscribe(caro.cookie, subscription("https://web.push.apple.com/tablet"));
    const again = subscription("https://web.push.apple.com/tablet");
    again.keys.auth = "otraClaveAuth123456789";
    expect((await subscribe(caro.cookie, again)).status).toBe(204);

    const saved = await rows();
    expect(saved.map((row) => row.endpoint).sort()).toEqual([
      "https://fcm.googleapis.com/fcm/send/celular",
      "https://web.push.apple.com/tablet",
    ]);
    expect(saved.find((row) => row.endpoint.includes("tablet"))?.auth).toBe(
      "otraClaveAuth123456789",
    );
  });

  it("datos inválidos → 400 invalid_input sin guardar", async () => {
    const caro = await asCaro();
    for (const body of [
      {},
      { ...subscription(), endpoint: "http://inseguro.example/push" },
      { ...subscription(), endpoint: "no es una url" },
      { ...subscription(), keys: { p256dh: "", auth: "x" } },
      { ...subscription(), keys: { p256dh: "con espacios", auth: "x" } },
    ]) {
      const response = await subscribe(caro.cookie, body);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid_input");
    }
    expect(await rows()).toEqual([]);
  });
});

describe("POST /api/admin/push/subscription/delete", () => {
  it("borra la suscripción de este dispositivo y deja las demás", async () => {
    const caro = await asCaro();
    await subscribe(caro.cookie, subscription("https://fcm.googleapis.com/fcm/send/celular"));
    await subscribe(caro.cookie, subscription("https://web.push.apple.com/tablet"));

    const response = await unsubscribe(caro.cookie, {
      endpoint: "https://fcm.googleapis.com/fcm/send/celular",
    });
    expect(response.status).toBe(204);
    expect((await rows()).map((row) => row.endpoint)).toEqual([
      "https://web.push.apple.com/tablet",
    ]);
  });

  it("una clienta 403 y no borra nada; datos inválidos 400", async () => {
    const caro = await asCaro();
    const client = await signedIn("+573001234567");
    await subscribe(caro.cookie, subscription());
    expect((await unsubscribe(client.cookie, { endpoint: subscription().endpoint })).status).toBe(
      403,
    );
    expect((await unsubscribe(caro.cookie, {})).status).toBe(400);
    expect(await rows()).toHaveLength(1);
  });

  it("solo borra suscripciones de la misma cuenta", async () => {
    const caro = await asCaro();
    const other = await signedIn("+573009998877", "Otra admin", "admin");
    await subscribe(caro.cookie, subscription());
    expect((await unsubscribe(other.cookie, { endpoint: subscription().endpoint })).status).toBe(
      204,
    );
    const [row] = await database.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subscription().endpoint));
    expect(row?.userId).toBe(caro.userId);
  });
});
