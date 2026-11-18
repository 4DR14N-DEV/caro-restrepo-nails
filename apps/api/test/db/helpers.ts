import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "../../src/db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("Falta TEST_DATABASE_URL para los tests de base de datos (ver .env.example).");
  }
  return url;
}

// Crea la base de tests si no existe, la deja vacía y aplica todas las migraciones.
export async function createTestDatabase() {
  const url = new URL(testDatabaseUrl());
  const databaseName = url.pathname.slice(1);

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  }
  await admin.end();

  const pool = new pg.Pool({ connectionString: url.toString() });
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE;");
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });

  return { db, pool };
}
