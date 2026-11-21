import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";

// Turno de una fecha: las escrituras que cambian qué horas están libres ese día (reservar,
// reprogramar, cargar bloqueos o aperturas) van de a una. La segunda espera a la primera y
// vuelve a leer con sus cambios, así no hay carreras.
export function lockDay(tx: Pick<Database, "execute">, date: string) {
  return tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`booking:${date}`}))`);
}

// La espera tiene un tope: si el turno no se libera a tiempo, la escritura se rinde (55P03)
// en vez de ocupar una conexión sin fin.
export function limitLockWait(tx: Pick<Database, "execute">) {
  return tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
}
