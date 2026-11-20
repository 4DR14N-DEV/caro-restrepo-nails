import type { RequestHandler } from "express";
import type { Database } from "../db/client.js";
import { readSessionCookie, setSessionCookie } from "./cookies.js";
import { validateSession } from "./sessions.js";

// Deja pasar solo a una cuenta admin con sesión válida: 401 sin sesión, 403 si la
// cuenta no es admin.
export function requireAdmin(db: Database): RequestHandler {
  return async (req, res, next) => {
    const token = readSessionCookie(req);
    const session = token ? await validateSession(db, token) : null;
    if (!token || !session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    if (session.renewed) setSessionCookie(res, token);
    if (session.user.role !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
