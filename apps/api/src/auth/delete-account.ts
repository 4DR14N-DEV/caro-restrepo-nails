import { DELETED_CLIENT_NAME } from "@caro/shared";
import { and, eq, gte } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { appointments, sessions, users } from "../db/schema.js";
import { clearAttempts, limitKey, loginPhoneLimit } from "./rate-limit.js";

// Borra la cuenta de una clienta (RF22, Ley 1581): se anonimizan sus datos y se conservan
// las citas pasadas. Las próximas se cancelan (si no, quedarían a nombre de nadie) y liberan
// la hora, sin el plazo de cancelación de las clientas. Todo en una transacción.
export async function deleteClientAccount(
  db: Database,
  user: { id: string; phone: string },
  current: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Se bloquea la fila primero: una reserva de esta misma clienta que se esté guardando a
    // la vez espera a que termine el borrado.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");

    await tx
      .update(appointments)
      .set({ status: "cancelled", cancelledBy: "client", cancelledAt: current })
      .where(
        and(
          eq(appointments.clientId, user.id),
          eq(appointments.status, "scheduled"),
          gte(appointments.startAt, current),
        ),
      );
    await tx
      .update(users)
      .set({
        name: DELETED_CLIENT_NAME,
        phone: null,
        passwordHash: null,
        anonymizedAt: current,
        updatedAt: current,
      })
      .where(eq(users.id, user.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    // Los intentos de ingreso se guardan con el celular: también se borran.
    await clearAttempts(tx, limitKey(loginPhoneLimit, user.phone));
  });
}
