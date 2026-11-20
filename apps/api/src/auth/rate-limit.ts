import { isIPv4, isIPv6 } from "node:net";
import { eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { rateLimits } from "../db/schema.js";

export interface Limit {
  // Prefijo de la clave en `rate_limits`.
  kind: string;
  // Intentos permitidos dentro de la ventana.
  max: number;
  window: SQL;
  lock: SQL;
  lockSeconds: number;
}

// Ingreso por teléfono: 5 fallos en 15 minutos bloquean ese teléfono 15 minutos.
export const loginPhoneLimit: Limit = {
  kind: "login-phone",
  max: 5,
  window: sql`interval '15 minutes'`,
  lock: sql`interval '15 minutes'`,
  lockSeconds: 15 * 60,
};

// Ingreso por IP: 20 fallos en 15 minutos bloquean esa IP 15 minutos. Frena a quien
// prueba una contraseña común contra muchos celulares distintos.
export const loginIpLimit: Limit = {
  kind: "login-ip",
  max: 20,
  window: sql`interval '15 minutes'`,
  lock: sql`interval '15 minutes'`,
  lockSeconds: 15 * 60,
};

// Registro por IP: 5 intentos por hora. Frena la consulta masiva de qué celulares
// tienen cuenta (el 409) y el costo de calcular Argon2 en cada intento.
export const registerIpLimit: Limit = {
  kind: "register-ip",
  max: 5,
  window: sql`interval '1 hour'`,
  lock: sql`interval '1 hour'`,
  lockSeconds: 60 * 60,
};

// Ventana más larga de todos los límites: las filas que la superan ya no sirven.
const LONGEST_WINDOW = sql`interval '1 hour'`;

export function limitKey(limit: Limit, value: string): string {
  return `${limit.kind}:${value}`;
}

// Valor de la IP para los límites. Un proveedor suele darle a cada conexión IPv6 un
// bloque /64 entero, así que contar por dirección dejaría saltarse el límite cambiando
// de dirección dentro del bloque: se cuenta por bloque. Las IPv4 escritas como IPv6
// (::ffff:a.b.c.d) se tratan como IPv4.
export function ipBlock(ip: string): string {
  // Se quita la zona de las direcciones locales (fe80::1%eth0).
  const address = ip.split("%")[0]?.toLowerCase() ?? "";
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return ip;

  const groups = expandIPv6(address);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

// Los 8 grupos de 16 bits de una IPv6 ya validada, sin abreviar.
function expandIPv6(address: string): number[] {
  // Una IPv4 al final (::ffff:192.0.2.1) equivale a los dos últimos grupos.
  const ipv4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  const text = ipv4
    ? address.slice(0, ipv4.index) +
      [0, 2].map((i) => ((Number(ipv4[i + 1]) << 8) | Number(ipv4[i + 2])).toString(16)).join(":")
    : address;

  const parse = (part: string | undefined) =>
    part ? part.split(":").map((group) => parseInt(group, 16)) : [];
  const [head, tail] = text.split("::");
  const start = parse(head);
  if (tail === undefined) return start;
  const end = parse(tail);
  return [...start, ...new Array<number>(8 - start.length - end.length).fill(0), ...end];
}

// Reserva un intento ANTES de hacer el trabajo, en una sola sentencia atómica.
// Así los intentos simultáneos no pasan todos el chequeo a la vez: cada uno recibe su
// propio número dentro de la ventana.
// Devuelve null si el intento puede seguir, o los segundos que faltan para desbloquear.
export async function claimAttempt(
  db: Database,
  limit: Limit,
  key: string,
): Promise<number | null> {
  const locked = sql`${rateLimits.lockedUntil} > now()`;
  const windowExpired = sql`${rateLimits.windowStartedAt} <= now() - ${limit.window}`;

  const [row] = await db
    .insert(rateLimits)
    .values({ key, failedCount: 1, windowStartedAt: sql`now()` })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        // Durante un bloqueo no se cuenta nada; si la ventana venció, empieza otra.
        failedCount: sql`CASE WHEN ${locked} THEN ${rateLimits.failedCount} WHEN ${windowExpired} THEN 1 ELSE ${rateLimits.failedCount} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${locked} OR NOT ${windowExpired} THEN ${rateLimits.windowStartedAt} ELSE now() END`,
      },
    })
    .returning({
      attempts: rateLimits.failedCount,
      lockedSeconds: sql<
        number | null
      >`ceil(extract(epoch from ${rateLimits.lockedUntil} - now()))::int`,
    });

  if (!row) return null;
  if (row.lockedSeconds !== null && row.lockedSeconds > 0) return row.lockedSeconds;
  if (row.attempts <= limit.max) return null;

  // Más intentos simultáneos que el máximo: es una ráfaga, se bloquea ya.
  await lock(db, limit, key, sql`true`);
  return limit.lockSeconds;
}

// Tras un fallo: si ya se agotaron los intentos de la ventana, bloquea la clave.
export async function lockIfExhausted(db: Database, limit: Limit, key: string): Promise<void> {
  await lock(db, limit, key, sql`${rateLimits.failedCount} >= ${limit.max}`);
}

// Bloquea la clave y reinicia el conteo, salvo que ya esté bloqueada.
async function lock(db: Database, limit: Limit, key: string, condition: SQL): Promise<void> {
  await db
    .update(rateLimits)
    .set({ failedCount: 0, windowStartedAt: sql`now()`, lockedUntil: sql`now() + ${limit.lock}` })
    .where(
      sql`${rateLimits.key} = ${key} AND (${rateLimits.lockedUntil} IS NULL OR ${rateLimits.lockedUntil} <= now()) AND ${condition}`,
    );
}

// Devuelve un intento reservado que no fue un fallo (un acierto que no debe sumar,
// o un error del servidor que no es culpa de la clienta).
export async function releaseAttempt(db: Database, key: string): Promise<void> {
  await db
    .update(rateLimits)
    .set({ failedCount: sql`greatest(${rateLimits.failedCount} - 1, 0)` })
    .where(eq(rateLimits.key, key));
}

export async function clearAttempts(db: Database, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

// Borra las filas que ya no limitan nada: ventana vencida y sin bloqueo vigente.
// Se llama en cada ingreso y registro para que la tabla no crezca sin límite. Es solo
// limpieza: si falla, se registra el error y la petición sigue (las filas vencidas no
// limitan a nadie, se borran en otra petición).
export async function pruneExpired(db: Database): Promise<void> {
  try {
    await db
      .delete(rateLimits)
      .where(
        sql`${rateLimits.windowStartedAt} <= now() - ${LONGEST_WINDOW} AND (${rateLimits.lockedUntil} IS NULL OR ${rateLimits.lockedUntil} <= now())`,
      );
  } catch (error) {
    console.error("No se pudieron borrar los límites vencidos:", error);
  }
}
