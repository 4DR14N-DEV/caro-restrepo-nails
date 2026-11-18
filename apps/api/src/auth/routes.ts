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
import { clearFailures, lockedSeconds, recordFailure } from "./throttle.js";

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

export function authRouter(db: Database): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    const { name, phone, password } = parsed.data;
    const [user] = await db
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
  });

  router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    const { phone, password } = parsed.data;
    const retryAfter = await lockedSeconds(db, phone);
    if (retryAfter !== null) {
      res.set("Retry-After", String(retryAfter)).status(429).json({ error: "too_many_attempts" });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.phone, phone));
    const valid =
      user?.passwordHash && user.phone
        ? await verifyPassword(user.passwordHash, password)
        : await verifyAgainstDummy(password);

    if (!valid || !user?.phone) {
      await recordFailure(db, phone);
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    await clearFailures(db, phone);
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
