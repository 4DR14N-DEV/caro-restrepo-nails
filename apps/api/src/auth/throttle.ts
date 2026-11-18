import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { loginThrottles } from "../db/schema.js";

// 5 intentos fallidos dentro de una ventana de 15 minutos bloquean el teléfono 15 minutos.
const MAX_ATTEMPTS = 5;
const WINDOW = sql`interval '15 minutes'`;
const LOCK = sql`interval '15 minutes'`;
const LOCK_SECONDS = 15 * 60;

// Reserva un intento ANTES de verificar la contraseña, en una sola sentencia atómica.
// Así los intentos simultáneos no pueden pasar todos el chequeo a la vez: cada uno
// recibe su propio número dentro de la ventana. `failed_count` cuenta los fallos más
// los intentos en curso; un ingreso correcto borra la fila.
// Devuelve null si el intento puede seguir, o los segundos que faltan para desbloquear.
export async function claimAttempt(db: Database, phone: string): Promise<number | null> {
  const locked = sql`${loginThrottles.lockedUntil} > now()`;
  const windowExpired = sql`${loginThrottles.windowStartedAt} <= now() - ${WINDOW}`;

  const [row] = await db
    .insert(loginThrottles)
    .values({ phone, failedCount: 1, windowStartedAt: sql`now()` })
    .onConflictDoUpdate({
      target: loginThrottles.phone,
      set: {
        // Durante un bloqueo no se cuenta nada; si la ventana venció, empieza otra.
        failedCount: sql`CASE WHEN ${locked} THEN ${loginThrottles.failedCount} WHEN ${windowExpired} THEN 1 ELSE ${loginThrottles.failedCount} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${locked} OR NOT ${windowExpired} THEN ${loginThrottles.windowStartedAt} ELSE now() END`,
      },
    })
    .returning({
      attempts: loginThrottles.failedCount,
      lockedSeconds: sql<
        number | null
      >`ceil(extract(epoch from ${loginThrottles.lockedUntil} - now()))::int`,
    });

  if (!row) return null;
  if (row.lockedSeconds !== null && row.lockedSeconds > 0) return row.lockedSeconds;
  if (row.attempts <= MAX_ATTEMPTS) return null;

  // Más intentos simultáneos que el máximo: es una ráfaga, se bloquea ya.
  await lock(db, phone);
  return LOCK_SECONDS;
}

// Tras un fallo: si ya se agotaron los intentos de la ventana, bloquea el teléfono.
export async function lockIfExhausted(db: Database, phone: string): Promise<void> {
  await lock(db, phone, sql`${loginThrottles.failedCount} >= ${MAX_ATTEMPTS}`);
}

// Bloquea el teléfono y reinicia el conteo, salvo que ya esté bloqueado.
async function lock(db: Database, phone: string, condition = sql`true`): Promise<void> {
  await db
    .update(loginThrottles)
    .set({ failedCount: 0, windowStartedAt: sql`now()`, lockedUntil: sql`now() + ${LOCK}` })
    .where(
      sql`${loginThrottles.phone} = ${phone} AND (${loginThrottles.lockedUntil} IS NULL OR ${loginThrottles.lockedUntil} <= now()) AND ${condition}`,
    );
}

export async function clearFailures(db: Database, phone: string): Promise<void> {
  await db.delete(loginThrottles).where(eq(loginThrottles.phone, phone));
}
