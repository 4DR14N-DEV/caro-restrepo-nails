import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "../../src/db/seed-data.js";
import { pingDatabase, runKeepAlive } from "../../src/db/keepalive.js";
import { createTestDatabase, testDatabaseUrl } from "./helpers.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

beforeEach(async () => {
  await database.pool.query("TRUNCATE services CASCADE");
  await seed(database.db);
});

afterAll(async () => {
  await database.pool.end();
});

describe("consulta diaria para que Supabase no pause el proyecto", () => {
  it("consulta una tabla real y devuelve cuántos servicios hay", async () => {
    expect(await pingDatabase(database.db)).toBe(10);
  });

  it("con DATABASE_URL, consulta y cierra su conexión", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await runKeepAlive(testDatabaseUrl())).toBe(true);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("10 servicios"));
    info.mockRestore();
  });

  it("sin DATABASE_URL no intenta conectarse y lo dice en el log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runKeepAlive(undefined)).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"));
    error.mockRestore();
  });

  it("si la base no responde, no lanza: lo registra y devuelve false", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const url = new URL(testDatabaseUrl());
    url.port = "1";
    expect(await runKeepAlive(url.toString())).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
