import { isUuid, serviceInputSchema, serviceUpdateSchema, type AdminService } from "@caro/shared";
import { asc, eq, sql } from "drizzle-orm";
import { Router, type Response } from "express";
import { requireAdmin } from "../auth/require-admin.js";
import type { Database } from "../db/client.js";
import { hasPgCode, UNIQUE_VIOLATION } from "../db/errors.js";
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

function nameTaken(res: Response): void {
  res
    .status(409)
    .json({ error: "name_taken", fields: { name: "Ya existe un servicio con ese nombre." } });
}

// En `services` la única restricción única es el nombre; crear y editar la detectan igual.
const isUniqueViolation = (error: unknown) => hasPgCode(error, UNIQUE_VIOLATION);

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

    let service: AdminService | undefined;
    try {
      // Un servicio nuevo va al final del catálogo.
      [service] = await db
        .insert(services)
        .values({
          ...parsed.data,
          sortOrder: sql`(SELECT coalesce(max(${services.sortOrder}), 0) + 1 FROM ${services})`,
        })
        .returning(adminColumns);
    } catch (error) {
      if (isUniqueViolation(error)) return nameTaken(res);
      throw error;
    }

    res.status(201).json({ service });
  });

  router.patch("/:id", async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
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
