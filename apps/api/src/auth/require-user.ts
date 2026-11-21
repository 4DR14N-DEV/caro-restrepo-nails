import type { Request, Response } from "express";
import type { Database } from "../db/client.js";
import { readSessionCookie, setSessionCookie } from "./cookies.js";
import { validateSession } from "./sessions.js";

export type SessionUser = NonNullable<Awaited<ReturnType<typeof validateSession>>>["user"];

// La cuenta de la sesión actual. Sin sesión válida responde 401 y devuelve undefined;
// si la sesión se renovó, reenvía la cookie (como `/me`).
export async function currentUser(
  db: Database,
  req: Request,
  res: Response,
): Promise<SessionUser | undefined> {
  const token = readSessionCookie(req);
  const session = token ? await validateSession(db, token) : null;
  if (!token || !session) {
    res.status(401).json({ error: "unauthorized" });
    return undefined;
  }

  if (session.renewed) setSessionCookie(res, token);
  return session.user;
}
