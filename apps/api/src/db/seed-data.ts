import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { businessHours, services, settings } from "./schema.js";
import type * as schema from "./schema.js";

// Catálogo real entregado por Caro (2026-11-18). Precios en COP, duración en minutos.
const catalog = [
  { name: "Semipermanente manos", priceCop: 40000, durationMinutes: 60 },
  { name: "Semipermanente pies", priceCop: 40000, durationMinutes: 60 },
  { name: "Semipermanente con baño de acrílico", priceCop: 60000, durationMinutes: 90 },
  { name: "Semipermanente con base rubber", priceCop: 60000, durationMinutes: 90 },
  { name: "Press on", priceCop: 80000, durationMinutes: 120 },
  { name: "Retoque", priceCop: 60000, durationMinutes: 90 },
  { name: "Acrílico con tips", priceCop: 100000, durationMinutes: 150 },
  { name: "Acrílicas esculpidas", priceCop: 120000, durationMinutes: 180 },
  { name: "Retoque de acrílico", priceCop: 80000, durationMinutes: 150 },
  { name: "Retiro", priceCop: 15000, durationMinutes: 30 },
];

// Lunes (1) a sábado (6), de 9:00 a 19:00.
const weeklyHours = [1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: "09:00",
  closesAt: "19:00",
}));

// Carga los datos iniciales. Es idempotente: si un registro ya existe no lo toca,
// así una nueva corrida no pisa los cambios que Caro haga desde el panel. El catálogo
// se carga solo si no hay ningún servicio: si Caro renombró uno, no vuelve a aparecer.
export async function seed(db: NodePgDatabase<typeof schema>): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: services.id }).from(services).limit(1);
    if (!existing) {
      await tx
        .insert(services)
        .values(catalog.map((service, index) => ({ ...service, sortOrder: index + 1 })));
    }
    await tx.insert(businessHours).values(weeklyHours).onConflictDoNothing();
    await tx.insert(settings).values({ id: 1 }).onConflictDoNothing();
  });
}
