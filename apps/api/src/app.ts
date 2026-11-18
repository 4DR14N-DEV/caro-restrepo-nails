import express, { type Express } from "express";

// Construye la aplicación Express sin atarla a ninguna plataforma.
// El servidor local y el adaptador de Netlify solo la envuelven.
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}
