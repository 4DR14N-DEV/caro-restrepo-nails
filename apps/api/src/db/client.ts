import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

// Crea la conexión a Postgres. En producción, DATABASE_URL apunta al pooler de Supabase.
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}
