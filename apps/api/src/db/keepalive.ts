import { count } from "drizzle-orm";
import { createDatabase, type Database } from "./client.js";
import { services } from "./schema.js";

// Supabase pausa los proyectos gratis con poca actividad en una semana (D06). Unas pocas
// consultas reales por día alcanzan: la función programada de Netlify llama a esto.

// Una consulta a una tabla real (no un `select 1`): cuenta los servicios.
export async function pingDatabase(db: Database): Promise<number> {
  const [row] = await db.select({ total: count() }).from(services);
  return row?.total ?? 0;
}

// Abre una conexión, consulta y la cierra. Nunca lanza: devuelve si pudo consultar y deja el
// motivo en el log de la función.
export async function runKeepAlive(url: string | undefined): Promise<boolean> {
  if (!url) {
    console.error("Falta DATABASE_URL: no se pudo consultar la base para que no se pause.");
    return false;
  }
  const { db, pool } = createDatabase(url, { max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const total = await pingDatabase(db);
    console.info(`Base activa: ${total} servicios.`);
    return true;
  } catch (error) {
    console.error("No se pudo consultar la base para que no se pause.", error);
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
