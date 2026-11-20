import type { RequestHandler } from "express";
import type { Database } from "../db/client.js";
import { currentUser } from "./require-user.js";

// Deja pasar solo a una cuenta admin con sesión válida: 401 sin sesión, 403 si la
// cuenta no es admin.
export function requireAdmin(db: Database): RequestHandler {
  return async (req, res, next) => {
    const user = await currentUser(db, req, res);
    if (!user) return;
    if (user.role !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
