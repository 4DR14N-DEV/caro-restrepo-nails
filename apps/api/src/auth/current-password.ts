import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";
import { verifyPassword } from "./password.js";
import {
  claimAttempt,
  clearAttempts,
  limitKey,
  lockIfExhausted,
  loginPhoneLimit,
  releaseAttempt,
} from "./rate-limit.js";

// Revisa la contraseña actual de una usuaria con sesión antes de algo delicado (cambiarla o
// borrar la cuenta). Cada intento cuenta como un ingreso con ese celular, con el mismo límite:
// desde una sesión abierta no se puede adivinar la contraseña más rápido que en el ingreso.
// Devuelve "ok", "wrong" o los segundos que faltan si el celular está bloqueado.
export async function checkCurrentPassword(
  db: Database,
  user: { id: string; phone: string },
  password: string,
): Promise<"ok" | "wrong" | number> {
  const key = limitKey(loginPhoneLimit, user.phone);
  const retryAfter = await claimAttempt(db, loginPhoneLimit, key);
  if (retryAfter !== null) return retryAfter;

  let valid: boolean;
  try {
    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id));
    valid = row?.passwordHash ? await verifyPassword(row.passwordHash, password) : false;
  } catch (error) {
    // Un error del servidor no es culpa de la clienta: no cuenta como intento.
    await releaseAttempt(db, key).catch((releaseError: unknown) =>
      console.error("No se pudo devolver el intento:", releaseError),
    );
    throw error;
  }

  if (!valid) {
    await lockIfExhausted(db, loginPhoneLimit, key);
    return "wrong";
  }
  // Un acierto borra los fallos, como al ingresar.
  await clearAttempts(db, key);
  return "ok";
}
