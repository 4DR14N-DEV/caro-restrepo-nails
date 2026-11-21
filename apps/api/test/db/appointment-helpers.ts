import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { createSession } from "../../src/auth/sessions.js";
import { appointments, appointmentServices, services, users } from "../../src/db/schema.js";
import type { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

// Valores que deja una cancelación, para insertar citas ya canceladas. La fecha es fija para
// que no dependa del reloj real (los tests fijan el de la app).
export const cancelledValues = {
  status: "cancelled" as const,
  cancelledBy: "client" as const,
  cancelledAt: new Date("2026-11-19T12:00:00Z"),
};

// Datos de prueba de citas, compartidos por los tests que listan, cancelan y reprograman.
// Recibe la base como función porque se crea en `beforeAll`, después de armar los ayudantes.
export function appointmentHelpers(database: () => TestDatabase) {
  async function signedIn(phone: string, name = "Ana María", role: "client" | "admin" = "client") {
    const [user] = await database()
      .db.insert(users)
      .values({ name, phone, passwordHash: "hash-de-prueba", role, consentAcceptedAt: new Date() })
      .returning({ id: users.id });
    if (!user) throw new Error("No se creó la cuenta de prueba.");
    return { userId: user.id, cookie: `session=${await createSession(database().db, user.id)}` };
  }

  async function service(name: string) {
    const [row] = await database().db.select().from(services).where(eq(services.name, name));
    if (!row) throw new Error(`No existe el servicio ${name}.`);
    return row;
  }

  // Guarda una cita con la copia de sus servicios. `start` es la hora UTC de inicio.
  async function appointment(
    clientId: string,
    start: string,
    names: string[],
    values: Partial<typeof appointments.$inferInsert> = {},
  ) {
    const chosen = await Promise.all(names.map(service));
    const minutes = chosen.reduce((total, row) => total + row.durationMinutes, 0);
    const startAt = new Date(start);
    const endAt = new Date(startAt.getTime() + minutes * 60_000);
    const [row] = await database()
      .db.insert(appointments)
      .values({
        clientId,
        startAt,
        endAt,
        occupiedUntil: new Date(endAt.getTime() + 10 * 60_000),
        totalPriceCop: chosen.reduce((total, r) => total + r.priceCop, 0),
        createdBy: "client",
        ...values,
      })
      .returning({ id: appointments.id });
    if (!row) throw new Error("No se guardó la cita de prueba.");
    await database()
      .db.insert(appointmentServices)
      .values(
        chosen.map((r) => ({
          appointmentId: row.id,
          serviceId: r.id,
          serviceName: r.name,
          priceCop: r.priceCop,
          durationMinutes: r.durationMinutes,
        })),
      );
    return row.id;
  }

  // Espera a que la consulta de la API que empieza con `query` quede bloqueada por otra
  // conexión. Con un tope: si nunca se bloquea, falla con un mensaje claro en vez de colgarse.
  async function waitForBlocked(query: string) {
    let blocked = false;
    for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
      const { rows } = await database().pool.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND datname = current_database()
           AND query ILIKE $1`,
        [`${query}%`],
      );
      blocked = rows[0].n > 0;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(blocked, `la consulta "${query}" de la API tenía que esperar`).toBe(true);
  }

  return { signedIn, service, appointment, waitForBlocked };
}
