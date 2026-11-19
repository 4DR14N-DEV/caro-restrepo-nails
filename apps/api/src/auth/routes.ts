import { loginSchema, registerSchema, type PublicUser } from "@caro/shared";
import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password.js";
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  SESSION_DAYS,
  validateSession,
} from "./sessions.js";
import {
  claimAttempt,
  clearAttempts,
  limitKey,
  lockIfExhausted,
  loginIpLimit,
  loginPhoneLimit,
  pruneExpired,
  registerIpLimit,
  releaseAttempt,
} from "./rate-limit.js";

const COOKIE_NAME = "session";

// httpOnly: el JavaScript de la página no puede leerla. SameSite=Lax: otros sitios no
// pueden enviarla en un POST, lo que protege de CSRF.
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
}

function readSessionCookie(req: Request): string | undefined {
  for (const part of req.headers.cookie?.split(";") ?? []) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=") || undefined;
  }
  return undefined;
}

// Primer mensaje de error por campo, listo para mostrar en el formulario.
function invalidInput(
  res: Response,
  error: { issues: { path: PropertyKey[]; message: string }[] },
): void {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    fields[field] ??= issue.message;
  }
  res.status(400).json({ error: "invalid_input", fields });
}

function toPublicUser(user: { id: string; name: string; phone: string; role: PublicUser["role"] }) {
  return { id: user.id, name: user.name, phone: user.phone, role: user.role } satisfies PublicUser;
}

function tooManyAttempts(res: Response, retryAfterSeconds: number): void {
  res
    .set("Retry-After", String(retryAfterSeconds))
    .status(429)
    .json({ error: "too_many_attempts" });
}

// Devuelve la IP de la clienta, o undefined si la plataforma no la informa.
export type ClientIp = (req: Request) => string | undefined;

export function authRouter(db: Database, clientIp: ClientIp): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    await pruneExpired(db);
    const ip = clientIp(req);
    // Cada intento de registro cuenta, salga bien o mal: así no se puede consultar en
    // masa qué celulares tienen cuenta.
    const ipKey = ip === undefined ? undefined : limitKey(registerIpLimit, ip);
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
      // Un error del servidor no es culpa de la clienta: no cuenta como intento.
      if (ipKey) await releaseAttempt(db, ipKey);
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
    const ipKey = ip === undefined ? undefined : limitKey(loginIpLimit, ip);
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

    // Un acierto borra los fallos del teléfono y no suma al conteo de la IP.
    await clearAttempts(db, phoneKey);
    if (ipKey) await releaseAttempt(db, ipKey);
    // La sesión anterior de este navegador (si la había) se reemplaza por la nueva.
    const previousToken = readSessionCookie(req);
    if (previousToken) await deleteSession(db, previousToken);
    await deleteExpiredSessions(db, user.id);
    setSessionCookie(res, await createSession(db, user.id));
    res.json({ user: toPublicUser({ ...user, phone: user.phone }) });
  });

  router.post("/logout", async (req, res) => {
    const token = readSessionCookie(req);
    if (token) await deleteSession(db, token);
    res.clearCookie(COOKIE_NAME, cookieOptions);
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
