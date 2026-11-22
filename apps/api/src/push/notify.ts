import { appointmentNoticePayload, type AppointmentNotice } from "@caro/shared";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { pushSubscriptions, users } from "../db/schema.js";
import type { PushService } from "./sender.js";

// Avisa a Caro lo que hizo una clienta con sus citas (RF18).
export type NotifyAdmins = (notices: AppointmentNotice[]) => Promise<void>;

// Se llama después de guardar y antes de responder: en Netlify Functions la función puede
// congelarse apenas responde. Nunca lanza: si un aviso no sale, el cambio de la clienta ya
// está guardado y su respuesta no cambia. Cada envío tiene su tiempo límite (`sender.ts`).
export function adminNotifier(db: Database, push: PushService | null): NotifyAdmins {
  return async (notices) => {
    if (!push || notices.length === 0) return;
    try {
      // Solo los dispositivos de cuentas admin.
      const targets = await db
        .select({
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .innerJoin(users, eq(users.id, pushSubscriptions.userId))
        .where(eq(users.role, "admin"));
      if (targets.length === 0) return;

      const payloads = notices.map((notice) => JSON.stringify(appointmentNoticePayload(notice)));
      const results = await Promise.allSettled(
        targets.flatMap((target) =>
          payloads.map(async (payload) => ({
            endpoint: target.endpoint,
            result: await push.send(
              { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
              payload,
            ),
          })),
        ),
      );

      const gone = new Set<string>();
      for (const outcome of results) {
        if (outcome.status === "rejected") {
          console.error("No se pudo enviar un aviso push.", outcome.reason);
        } else if (outcome.value.result === "gone") {
          gone.add(outcome.value.endpoint);
        }
      }
      // El servicio de push dice que ya no existen: se borran para no volver a intentarlo.
      if (gone.size > 0) {
        await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, [...gone]));
      }
    } catch (error) {
      console.error("No se pudieron enviar los avisos push.", error);
    }
  };
}
