import type { Request, Response } from "express";
import { SESSION_DAYS } from "./sessions.js";

const COOKIE_NAME = "session";

// httpOnly: el JavaScript de la página no puede leerla. SameSite=Lax: otros sitios no
// pueden enviarla en un POST, lo que protege de CSRF.
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions);
}

export function readSessionCookie(req: Request): string | undefined {
  for (const part of req.headers.cookie?.split(";") ?? []) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=") || undefined;
  }
  return undefined;
}
