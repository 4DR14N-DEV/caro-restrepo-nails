import { serviceInputSchema, serviceUpdateSchema, type AdminService } from "@caro/shared";
import { asc, eq, sql } from "drizzle-orm";
import { Router, type Response } from "express";
import { requireAdmin } from "../auth/require-admin.js";
import type { Database } from "../db/client.js";
import { services } from "../db/schema.js";
import { invalidInput } from "../http.js";

// Lo que el panel ve de cada servicio.
const adminColumns = {
  id: services.id,
  name: services.name,
  priceCop: services.priceCop,
  durationMinutes: services.durationMinutes,
  active: services.active,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nameTaken(res: Response): void {
  res
    .status(409)
    .json({ error: "name_taken", fields: { name: "Ya existe un servicio con ese nombre." } });
}

// Postgres 23505: violación de una restricción única (aquí, el nombre del servicio).
// Drizzle puede envolver el error del driver, así que se mira también la causa.
function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown) => (value as { code?: unknown } | null)?.code;
  return code(error) === "23505" || code((error as { cause?: unknown } | null)?.cause) === "23505";
}

// Panel de Caro: crear, editar, activar y desactivar servicios. No se borran: las citas
// guardan su propia copia, pero siguen referenciando el servicio.
export function adminServicesRouter(db: Database): Router {
  const router = Router();
  router.use(requireAdmin(db));

  router.get("/", async (_req, res) => {
    const rows: AdminService[] = await db
      .select(adminColumns)
      .from(services)
      .orderBy(asc(services.sortOrder), asc(services.name));
    res.json({ services: rows });
  });

  router.post("/", async (req, res) => {
    const parsed = serviceInputSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    // Un servicio nuevo va al final del catálogo.
    const [service] = await db
      .insert(services)
      .values({
        ...parsed.data,
        sortOrder: sql`(SELECT coalesce(max(${services.sortOrder}), 0) + 1 FROM ${services})`,
      })
      .onConflictDoNothing({ target: services.name })
      .returning(adminColumns);
    if (!service) return nameTaken(res);

    res.status(201).json({ service });
  });

  router.patch("/:id", async (req, res) => {
    const { id } = req.params;
    if (!UUID.test(id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const parsed = serviceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);

    let service: AdminService | undefined;
    try {
      [service] = await db
        .update(services)
        .set({ ...parsed.data, updatedAt: sql`now()` })
        .where(eq(services.id, id))
        .returning(adminColumns);
    } catch (error) {
      if (isUniqueViolation(error)) return nameTaken(res);
      throw error;
    }

    if (!service) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ service });
  });

  return router;
}
