import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

// Crea la conexión a Postgres. En producción, DATABASE_URL apunta al pooler de Supabase.
// `max` limita las conexiones del pool (en una función serverless conviene 1).
export function createDatabase(
  connectionString: string,
  options: { max?: number; connectionTimeoutMillis?: number } = {},
) {
  const pool = new pg.Pool({ connectionString, ...options });
  return { db: drizzle(pool, { schema }), pool };
}
