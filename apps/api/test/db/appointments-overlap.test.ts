import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appointments, settings, users } from "../../src/db/schema.js";
import { createTestDatabase } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;
let clientId: string;

// Código de Postgres para una violación de restricción de exclusión.
const EXCLUSION_VIOLATION = "23P01";
const CHECK_VIOLATION = "23514";

// Extrae el código de Postgres, que Drizzle envuelve en `cause`.
function pgErrorCode(error: unknown): string | undefined {
  const candidate = (error as { cause?: { code?: string }; code?: string }) ?? {};
  return candidate.cause?.code ?? candidate.code;
}

async function expectPgError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, "se esperaba que la base de datos rechazara la operación").toBeDefined();
  expect(pgErrorCode(error)).toBe(code);
}

function appointment(start: string, end: string, occupiedUntil: string) {
  return {
    clientId,
    startAt: new Date(start),
    endAt: new Date(end),
    occupiedUntil: new Date(occupiedUntil),
    totalPriceCop: 40000,
    createdBy: "client" as const,
  };
}

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.pool.end();
});

beforeEach(async () => {
  await database.pool.query("TRUNCATE appointments, users CASCADE");
  const [client] = await database.db
    .insert(users)
    .values({
      name: "Laura Gómez",
      phone: "+573001234567",
      passwordHash: "hash",
      consentAcceptedAt: new Date(),
    })
    .returning({ id: users.id });
  if (!client) throw new Error("No se pudo crear la clienta de prueba.");
  clientId = client.id;
});

describe("restricción anti-superposición de citas", () => {
  // Cita de 9:00 a 10:00 (hora de Colombia) con 10 minutos de margen: ocupa hasta las 10:10.
  const first = () =>
    appointment(
      "2026-12-18T09:00:00-05:00",
      "2026-12-18T10:00:00-05:00",
      "2026-12-18T10:10:00-05:00",
    );

  it("rechaza una cita que se cruza con otra activa", async () => {
    await database.db.insert(appointments).values(first());

    await expectPgError(
      database.db
        .insert(appointments)
        .values(
          appointment(
            "2026-12-18T09:30:00-05:00",
            "2026-12-18T10:30:00-05:00",
            "2026-12-18T10:40:00-05:00",
          ),
        ),
      EXCLUSION_VIOLATION,
    );
  });

  it("rechaza una cita que empieza dentro del margen de la anterior", async () => {
    await database.db.insert(appointments).values(first());

    await expectPgError(
      database.db
        .insert(appointments)
        .values(
          appointment(
            "2026-12-18T10:05:00-05:00",
            "2026-12-18T11:05:00-05:00",
            "2026-12-18T11:15:00-05:00",
          ),
        ),
      EXCLUSION_VIOLATION,
    );
  });

  it("acepta una cita que empieza justo cuando termina el margen", async () => {
    await database.db.insert(appointments).values(first());

    await database.db
      .insert(appointments)
      .values(
        appointment(
          "2026-12-18T10:10:00-05:00",
          "2026-12-18T11:10:00-05:00",
          "2026-12-18T11:20:00-05:00",
        ),
      );

    const rows = await database.db.select().from(appointments);
    expect(rows).toHaveLength(2);
  });

  it("una cita cancelada libera su horario", async () => {
    await database.db.insert(appointments).values({
      ...first(),
      status: "cancelled",
      cancelledBy: "client",
      cancelledAt: new Date(),
    });

    await database.db.insert(appointments).values(first());

    const rows = await database.db.select().from(appointments);
    expect(rows).toHaveLength(2);
  });

  it("rechaza una cita cuyo fin es anterior a su inicio", async () => {
    await expectPgError(
      database.db
        .insert(appointments)
        .values(
          appointment(
            "2026-12-18T10:00:00-05:00",
            "2026-12-18T09:00:00-05:00",
            "2026-12-18T09:10:00-05:00",
          ),
        ),
      CHECK_VIOLATION,
    );
  });
});

describe("settings", () => {
  it("solo admite una fila (id = 1)", async () => {
    await expectPgError(database.db.insert(settings).values({ id: 2 }), CHECK_VIOLATION);
  });
});
