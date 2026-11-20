import type { PublicService } from "@caro/shared";
import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import type { Database } from "../db/client.js";
import { services } from "../db/schema.js";

// Catálogo público: solo los servicios activos, en el orden que define Caro.
export function servicesRouter(db: Database): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const rows: PublicService[] = await db
      .select({
        id: services.id,
        name: services.name,
        priceCop: services.priceCop,
        durationMinutes: services.durationMinutes,
      })
      .from(services)
      .where(eq(services.active, true))
      .orderBy(asc(services.sortOrder), asc(services.name));
    res.json({ services: rows });
  });

  return router;
}
