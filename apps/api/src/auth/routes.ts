import {
  changePasswordSchema,
  deleteAccountSchema,
  loginSchema,
  registerSchema,
  wrongPasswordMessage,
  type PublicUser,
} from "@caro/shared";
import { and, eq, isNull } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { bogotaDate, bogotaTime } from "../booking/dates.js";
import { serviceNamesByAppointment } from "../booking/service-copies.js";
import type { Database } from "../db/client.js";
import type { NotifyAdmins } from "../push/notify.js";
import { users } from "../db/schema.js";
import { invalidInput } from "../http.js";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "./cookies.js";
import { checkCurrentPassword } from "./current-password.js";
import { deleteClientAccount } from "./delete-account.js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password.js";
import {
  createSession,
  deleteExpiredSessions,
  deleteOtherSessions,
  deleteSession,
  validateSession,
} from "./sessions.js";
import {
  claimAttempt,
  clearAttempts,
  ipBlock,
  limitKey,
  lockIfExhausted,
  loginIpLimit,
  loginPhoneLimit,
  pruneExpired,
  registerIpLimit,
  releaseAttempt,
} from "./rate-limit.js";
import { currentUser } from "./require-user.js";

function toPublicUser(user: { id: string; name: string; phone: string; role: PublicUser["role"] }) {
  return { id: user.id, name: user.name, phone: user.phone, role: user.role } satisfies PublicUser;
}

function tooManyAttempts(res: Response, retryAfterSeconds: number): void {
  res
    .set("Retry-After", String(retryAfterSeconds))
    .status(429)
    .json({ error: "too_many_attempts" });
}

function wrongPassword(res: Response): void {
  res
    .status(400)
    .json({ error: "wrong_password", fields: { currentPassword: wrongPasswordMessage } });
}

// Devuelve la IP de la clienta, o undefined si la plataforma no la informa.
export type ClientIp = (req: Request) => string | undefined;

export function authRouter(
  db: Database,
  clientIp: ClientIp,
  now: () => Date,
  notifyAdmins: NotifyAdmins = async () => {},
): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    await pruneExpired(db);
    const ip = clientIp(req);
    // Cada intento de registro cuenta, salga bien o mal: así no se puede consultar en
    // masa qué celulares tienen cuenta.
    const ipKey = ip === undefined ? undefined : limitKey(registerIpLimit, ipBlock(ip));
    if (ipKey) {
      const retryAfter = await claimAttempt(db, registerIpLimit, ipKey);
      if (retryAfter !== null) return tooManyAttempts(res, retryAfter);
    }

    try {
      const { name, phone, password } = parsed.data;
      // Se revisa antes de calcular Argon2, que es caro; el insert igual cubre la carrera.
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phone, phone));
      const [user] = existing
        ? []
        : await db
            .insert(users)
            .values({
              name,
              phone,
              passwordHash: await hashPassword(password),
              consentAcceptedAt: new Date(),
            })
            .onConflictDoNothing({ target: users.phone })
            .returning();

      if (!user?.phone) {
        res.status(409).json({ error: "phone_taken" });
        return;
      }

      setSessionCookie(res, await createSession(db, user.id));
      res.status(201).json({ user: toPublicUser({ ...user, phone: user.phone }) });
    } catch (error) {
      // Un error del servidor no es culpa de la clienta: no cuenta como intento. Si
      // devolverlo también falla, se registra aparte y se sigue con el error original.
      if (ipKey) {
        await releaseAttempt(db, ipKey).catch((releaseError: unknown) =>
          console.error("No se pudo devolver el intento de registro:", releaseError),
        );
      }
      throw error;
    }
  });

  router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    const { phone, password } = parsed.data;
    await pruneExpired(db);

    // Dos límites: por IP (frena probar una contraseña contra muchos celulares) y por
    // teléfono (frena probar muchas contraseñas contra un celular).
    const ip = clientIp(req);
    const ipKey = ip === undefined ? undefined : limitKey(loginIpLimit, ipBlock(ip));
    const phoneKey = limitKey(loginPhoneLimit, phone);

    if (ipKey) {
      const retryAfter = await claimAttempt(db, loginIpLimit, ipKey);
      if (retryAfter !== null) return tooManyAttempts(res, retryAfter);
    }

    // Intentos reservados que todavía no se resolvieron. Si algo falla, se devuelven
    // (un error del servidor no es culpa de la clienta) y cada uno una sola vez.
    const pending = new Set<string>(ipKey ? [ipKey] : []);
    const release = async (key: string) => {
      if (pending.delete(key)) await releaseAttempt(db, key);
    };

    let user: typeof users.$inferSelect | undefined;
    let valid: boolean;
    try {
      const retryAfter = await claimAttempt(db, loginPhoneLimit, phoneKey);
      if (retryAfter !== null) {
        if (ipKey) await release(ipKey);
        return tooManyAttempts(res, retryAfter);
      }
      pending.add(phoneKey);

      [user] = await db.select().from(users).where(eq(users.phone, phone));
      valid =
        user?.passwordHash && user.phone
          ? await verifyPassword(user.passwordHash, password)
          : await verifyAgainstDummy(password);
    } catch (error) {
      // Se intentan devolver todos aunque alguno falle.
      await Promise.allSettled([...pending].map(release));
      throw error;
    }

    if (!valid || !user?.phone) {
      if (ipKey) await lockIfExhausted(db, loginIpLimit, ipKey);
      await lockIfExhausted(db, loginPhoneLimit, phoneKey);
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    let token: string;
    try {
      // Un acierto borra los fallos del teléfono y no suma al conteo de la IP.
      await clearAttempts(db, phoneKey);
      pending.delete(phoneKey);
      if (ipKey) await release(ipKey);
      // La sesión anterior de este navegador (si la había) se reemplaza por la nueva.
      const previousToken = readSessionCookie(req);
      if (previousToken) await deleteSession(db, previousToken);
      await deleteExpiredSessions(db, user.id);
      token = await createSession(db, user.id);
    } catch (error) {
      await Promise.allSettled([...pending].map(release));
      throw error;
    }

    setSessionCookie(res, token);
    res.json({ user: toPublicUser({ ...user, phone: user.phone }) });
  });

  router.post("/logout", async (req, res) => {
    const token = readSessionCookie(req);
    if (token) await deleteSession(db, token);
    clearSessionCookie(res);
    res.status(204).end();
  });

  // Cambiar la contraseña con la actual. La sesión de este navegador sigue; las demás se
  // cierran (por ejemplo, si alguien más conocía la contraseña vieja).
  router.post("/password", async (req, res) => {
    const user = await currentUser(db, req, res);
    if (!user) return;
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    const check = await checkCurrentPassword(db, user, parsed.data.currentPassword);
    if (typeof check === "number") return tooManyAttempts(res, check);
    if (check === "wrong") return wrongPassword(res);

    const passwordHash = await hashPassword(parsed.data.newPassword);
    const token = readSessionCookie(req) ?? "";
    // Solo una cuenta activa: si la clienta la borró a la vez desde otro dispositivo, la
    // cuenta borrada no recibe una contraseña nueva.
    const changed = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ passwordHash, updatedAt: now() })
        .where(and(eq(users.id, user.id), isNull(users.anonymizedAt)))
        .returning({ id: users.id });
      if (!row) return false;
      await deleteOtherSessions(tx, user.id, token);
      return true;
    });
    if (!changed) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.status(204).end();
  });

  // Borrar la cuenta (RF22), confirmando con la contraseña. La cuenta de Caro no se borra.
  router.post("/account/delete", async (req, res) => {
    const user = await currentUser(db, req, res);
    if (!user) return;
    if (user.role !== "client") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const parsed = deleteAccountSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    const check = await checkCurrentPassword(db, user, parsed.data.currentPassword);
    if (typeof check === "number") return tooManyAttempts(res, check);
    if (check === "wrong") return wrongPassword(res);

    const cancelled = await deleteClientAccount(db, user, now());
    // Un aviso por cada cita próxima cancelada, con el nombre que tenía la clienta. Los
    // servicios se leen dentro del aviso: si esa lectura falla, el borrado igual responde 204.
    await notifyAdmins(async () => {
      if (cancelled.length === 0) return [];
      const names = await serviceNamesByAppointment(
        db,
        cancelled.map((appointment) => appointment.id),
      );
      return cancelled
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
        .map((appointment) => ({
          kind: "cancelled" as const,
          clientName: user.name,
          services: names.get(appointment.id) ?? [],
          date: bogotaDate(appointment.startAt),
          time: bogotaTime(appointment.startAt),
        }));
    });
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get("/me", async (req, res) => {
    const token = readSessionCookie(req);
    const session = token ? await validateSession(db, token) : null;
    if (!token || !session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    if (session.renewed) setSessionCookie(res, token);
    res.json({ user: toPublicUser(session.user) });
  });

  return router;
}
