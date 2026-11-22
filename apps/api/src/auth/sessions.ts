import { createHash, randomBytes } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

export const SESSION_DAYS = 30;
// Si a la sesión le quedan menos días que esto, se extiende otra vez a 30.
const RENEW_BELOW_DAYS = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

// En la base solo se guarda el hash: quien lea la tabla no puede usar los tokens.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function expiresFromNow(): Date {
  return new Date(Date.now() + SESSION_DAYS * DAY_MS);
}

export async function createSession(db: Database, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt: expiresFromNow() });
  return token;
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

// Devuelve la usuaria de la sesión, o null si el token no existe o venció.
// `renewed` indica que se extendió el vencimiento y hay que reenviar la cookie.
export async function validateSession(db: Database, token: string) {
  const id = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      user: { id: users.id, name: users.name, phone: users.phone, role: users.role },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id));

  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  // Una cuenta anonimizada ya no tiene teléfono ni puede tener sesiones.
  if (row.user.phone === null) return null;

  const user = { ...row.user, phone: row.user.phone };
  const renewed = row.expiresAt.getTime() - Date.now() < RENEW_BELOW_DAYS * DAY_MS;
  if (renewed) {
    await db.update(sessions).set({ expiresAt: expiresFromNow() }).where(eq(sessions.id, id));
  }

  return { user, renewed };
}

// Borra las sesiones vencidas de una usuaria (limpieza oportunista al ingresar).
export async function deleteExpiredSessions(db: Database, userId: string): Promise<void> {
  await db
    .delete(sessions)
    .where(sql`${sessions.userId} = ${userId} AND ${sessions.expiresAt} <= now()`);
}

// Cierra las demás sesiones de una usuaria y deja la de `token` (al cambiar la contraseña).
export async function deleteOtherSessions(
  db: Pick<Database, "delete">,
  userId: string,
  token: string,
): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, hashToken(token))));
}
