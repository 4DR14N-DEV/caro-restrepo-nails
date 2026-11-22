import { appointmentNoticePayload, type AppointmentNotice } from "@caro/shared";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { pushSubscriptions, users } from "../db/schema.js";
import type { PushService } from "./sender.js";

// Los avisos, ya armados o como una función que los arma (por ejemplo, si hace falta leer la
// base): así esa lectura también queda protegida y no se hace si no hay avisos push.
type Notices = AppointmentNotice[] | (() => Promise<AppointmentNotice[]>);

// Avisa a Caro lo que hizo una clienta con sus citas (RF18).
export type NotifyAdmins = (notices: Notices) => Promise<void>;

// Tope total para avisar: el tiempo límite de `sender.ts` es por conexión, y una respuesta
// lenta pero constante podría demorar más la respuesta a la clienta.
const DEFAULT_DEADLINE_MS = 4000;

class DeadlineExceeded extends Error {}

// Se llama después de guardar y antes de responder: en Netlify Functions la función puede
// congelarse apenas responde. Nunca lanza y termina a lo sumo en `deadlineMs`: si un aviso no
// sale, el cambio de la clienta ya está guardado y su respuesta no cambia.
export function adminNotifier(
  db: Database,
  push: PushService | null,
  { deadlineMs = DEFAULT_DEADLINE_MS }: { deadlineMs?: number } = {},
): NotifyAdmins {
  async function send(service: PushService, notices: Notices): Promise<void> {
    const list = typeof notices === "function" ? await notices() : notices;
    if (list.length === 0) return;

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

    const payloads = list.map((notice) => JSON.stringify(appointmentNoticePayload(notice)));
    const results = await Promise.allSettled(
      targets.flatMap((target) =>
        payloads.map(async (payload) => ({
          endpoint: target.endpoint,
          result: await service.send(
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
  }

  return async (notices) => {
    if (!push) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new DeadlineExceeded()), deadlineMs);
    });
    try {
      await Promise.race([send(push, notices), deadline]);
    } catch (error) {
      if (error instanceof DeadlineExceeded) {
        console.error(`Los avisos push superaron el tiempo máximo (${deadlineMs} ms).`);
      } else {
        console.error("No se pudieron enviar los avisos push.", error);
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
