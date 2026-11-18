import express, { type ErrorRequestHandler, type Express } from "express";
import { authRouter } from "./auth/routes.js";
import type { Database } from "./db/client.js";

export interface AppDependencies {
  db: Database;
}

// Construye la aplicación Express sin atarla a ninguna plataforma.
// El servidor local y el adaptador de Netlify solo la envuelven.
export function createApp({ db }: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRouter(db));

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Errores siempre en JSON y sin detalles internos.
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "internal_error" });
  };
  app.use(errorHandler);

  return app;
}
