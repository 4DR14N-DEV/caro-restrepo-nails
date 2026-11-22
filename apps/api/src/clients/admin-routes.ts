import { isUuid, type ClientRow, type ClientSummary, type PasswordReset } from "@caro/shared";
import { and, asc, count, eq, gte, ilike, isNull, like, or } from "drizzle-orm";
import { Router, type Response } from "express";
import { generatePassword, hashPassword } from "../auth/password.js";
import { clearAttempts, limitKey, loginPhoneLimit } from "../auth/rate-limit.js";
import { requireAdmin } from "../auth/require-admin.js";
import { bogotaDate } from "../booking/dates.js";
import type { Database } from "../db/client.js";
import { appointments, sessions, users } from "../db/schema.js";

const SEARCH_LIMIT = 10;

function notFound(res: Response): void {
  res.status(404).json({ error: "not_found" });
}

// Clientas en el panel de Caro (RF17) y la búsqueda para agendar a su nombre (RF11). Solo admin.
export function adminClientsRouter(db: Database, now: () => Date): Router {
  const router = Router();
  router.use(requireAdmin(db));

  // Búsqueda para agendar a su nombre: por nombre o por celular.
  router.get("/", async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.json({ clients: [] });
      return;
    }
    // Los comodines de LIKE que escriba Caro se buscan como texto.
    const text = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const digits = q.replace(/\D/g, "");
    const rows = await db
      .select({ id: users.id, name: users.name, phone: users.phone })
      .from(users)
      .where(
        and(
          eq(users.role, "client"),
          isNull(users.anonymizedAt),
          or(
            ilike(users.name, text),
            digits.length >= 3 ? like(users.phone, `%${digits}%`) : undefined,
          ),
        ),
      )
      .orderBy(asc(users.name), asc(users.id))
      .limit(SEARCH_LIMIT);
    const clients: ClientSummary[] = rows.flatMap((row) =>
      row.phone ? [{ id: row.id, name: row.name, phone: row.phone }] : [],
    );
    res.set("Cache-Control", "no-store").json({ clients });
  });

  // Todas las clientas con cuenta, por nombre: cuándo se registraron y cuántas citas
  // agendadas tienen desde ahora. Las admins y las cuentas borradas no aparecen.
  router.get("/list", async (_req, res) => {
    const [rows, counts] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          phone: users.phone,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(and(eq(users.role, "client"), isNull(users.anonymizedAt)))
        .orderBy(asc(users.name), asc(users.id)),
      db
        .select({ clientId: appointments.clientId, upcoming: count() })
        .from(appointments)
        .where(and(eq(appointments.status, "scheduled"), gte(appointments.startAt, now())))
        .groupBy(appointments.clientId),
    ]);
    const upcoming = new Map(counts.map((row) => [row.clientId, row.upcoming]));
    const clients: ClientRow[] = rows.flatMap((row) =>
      row.phone
        ? [
            {
              id: row.id,
              name: row.name,
              phone: row.phone,
              registeredOn: bogotaDate(row.createdAt),
              upcoming: upcoming.get(row.id) ?? 0,
            },
          ]
        : [],
    );
    res.set("Cache-Control", "no-store").json({ clients });
  });

  // Clave nueva para una clienta que olvidó la suya (RF17). Se muestra una sola vez; cierra
  // sus sesiones y le quita el bloqueo por intentos fallidos. Nunca para una admin: la
  // contraseña de Caro se cambia con el comando de la API.
  router.post("/:id/password", async (req, res) => {
    const id = req.params.id;
    if (!isUuid(id)) return notFound(res);
    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    const client = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(and(eq(users.id, id), eq(users.role, "client"), isNull(users.anonymizedAt)))
        .returning({ id: users.id, name: users.name, phone: users.phone });
      if (!row?.phone) return undefined;
      await tx.delete(sessions).where(eq(sessions.userId, row.id));
      await clearAttempts(tx, limitKey(loginPhoneLimit, row.phone));
      return { id: row.id, name: row.name, phone: row.phone };
    });
    if (!client) return notFound(res);

    const result: PasswordReset = { client, password };
    res.set("Cache-Control", "no-store").json(result);
  });

  return router;
}
