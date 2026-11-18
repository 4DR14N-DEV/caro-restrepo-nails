import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { loginThrottles } from "../db/schema.js";

// 5 fallos dentro de una ventana de 15 minutos bloquean el teléfono 15 minutos.
const MAX_FAILURES = 5;
const WINDOW = sql`interval '15 minutes'`;
const LOCK = sql`interval '15 minutes'`;

// Segundos que faltan para que termine el bloqueo, o null si el teléfono no está bloqueado.
export async function lockedSeconds(db: Database, phone: string): Promise<number | null> {
  const [row] = await db
    .select({
      seconds: sql<number>`ceil(extract(epoch from ${loginThrottles.lockedUntil} - now()))::int`,
    })
    .from(loginThrottles)
    .where(sql`${loginThrottles.phone} = ${phone} AND ${loginThrottles.lockedUntil} > now()`);
  return row ? row.seconds : null;
}

// Suma un fallo. Si la ventana anterior ya venció, empieza una nueva.
// Al llegar al máximo bloquea el teléfono y reinicia el conteo.
export async function recordFailure(db: Database, phone: string): Promise<void> {
  const windowExpired = sql`${loginThrottles.windowStartedAt} <= now() - ${WINDOW}`;
  const [row] = await db
    .insert(loginThrottles)
    .values({ phone, failedCount: 1, windowStartedAt: sql`now()` })
    .onConflictDoUpdate({
      target: loginThrottles.phone,
      set: {
        failedCount: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${loginThrottles.failedCount} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${windowExpired} THEN now() ELSE ${loginThrottles.windowStartedAt} END`,
      },
    })
    .returning({ failedCount: loginThrottles.failedCount });

  if (row && row.failedCount >= MAX_FAILURES) {
    await db
      .update(loginThrottles)
      .set({ failedCount: 0, windowStartedAt: sql`now()`, lockedUntil: sql`now() + ${LOCK}` })
      .where(eq(loginThrottles.phone, phone));
  }
}

export async function clearFailures(db: Database, phone: string): Promise<void> {
  await db.delete(loginThrottles).where(eq(loginThrottles.phone, phone));
}
