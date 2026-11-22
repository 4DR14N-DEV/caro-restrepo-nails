import { pushEndpointSchema, pushSubscriptionSchema, type PushKey } from "@caro/shared";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin } from "../auth/require-admin.js";
import type { SessionUser } from "../auth/require-user.js";
import type { Database } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";
import { invalidInput } from "../http.js";
import type { PushService } from "./sender.js";

// Activar y desactivar los avisos push en cada dispositivo de Caro (RF18). Solo admin.
export function adminPushRouter(db: Database, push: PushService | null): Router {
  const router = Router();
  router.use(requireAdmin(db));

  router.get("/key", (_req, res) => {
    const body: PushKey = { publicKey: push?.publicKey ?? null };
    res.set("Cache-Control", "no-store").json(body);
  });

  // Un dispositivo se identifica por su endpoint: si ya estaba, se actualizan sus claves
  // y queda a nombre de la cuenta actual.
  router.put("/subscription", async (req, res) => {
    const parsed = pushSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const user = res.locals.user as SessionUser;
    const { endpoint, keys } = parsed.data;
    await db
      .insert(pushSubscriptions)
      .values({ userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth },
      });
    res.status(204).end();
  });

  router.post("/subscription/delete", async (req, res) => {
    const parsed = pushEndpointSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const user = res.locals.user as SessionUser;
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, parsed.data.endpoint),
          eq(pushSubscriptions.userId, user.id),
        ),
      );
    res.status(204).end();
  });

  return router;
}
