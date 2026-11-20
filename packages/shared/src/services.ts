import { z } from "zod";

// Servicios del catálogo, compartidos por la API y la web.
// Los mensajes son textos de UI: el panel de Caro los muestra tal cual.

// Servicio tal como lo muestra el catálogo público.
export interface PublicService {
  id: string;
  name: string;
  priceCop: number;
  durationMinutes: number;
}

// Servicio tal como lo ve Caro en el panel: incluye los desactivados.
export interface AdminService extends PublicService {
  active: boolean;
}

const nameMessage = "El nombre debe tener entre 2 y 60 caracteres.";
const priceMessage = "El precio debe ser un número entero entre 0 y 2.000.000.";
const durationMessage = "La duración debe estar entre 5 y 480 minutos.";

const serviceFields = {
  name: z.string(nameMessage).trim().min(2, nameMessage).max(60, nameMessage),
  // Pesos colombianos enteros, como en la base.
  priceCop: z
    .number(priceMessage)
    .int(priceMessage)
    .min(0, priceMessage)
    .max(2_000_000, priceMessage),
  durationMinutes: z
    .number(durationMessage)
    .int(durationMessage)
    .min(5, durationMessage)
    .max(480, durationMessage)
    .multipleOf(5, "La duración debe ser múltiplo de 5 minutos."),
};

export const serviceInputSchema = z.object(serviceFields);

// Editar cambia solo lo que llega; activar y desactivar también es una edición.
export const serviceUpdateSchema = z
  .object({
    name: serviceFields.name.optional(),
    priceCop: serviceFields.priceCop.optional(),
    durationMinutes: serviceFields.durationMinutes.optional(),
    active: z.boolean("Indica si el servicio está activo.").optional(),
  })
  .refine((update) => Object.values(update).some((value) => value !== undefined), {
    message: "No hay cambios para guardar.",
  });

export type ServiceInput = z.input<typeof serviceInputSchema>;
export type ServiceData = z.output<typeof serviceInputSchema>;
export type ServiceUpdate = z.output<typeof serviceUpdateSchema>;

// Pesos colombianos con punto de miles: 40000 → "$40.000". No depende del idioma del
// navegador ni del servidor, para que se vea igual en todos lados.
export function formatPrice(priceCop: number): string {
  return `$${String(priceCop).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

// 30 → "30 min", 60 → "1 h", 90 → "1 h 30 min".
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export interface Selection {
  count: number;
  durationMinutes: number;
  priceCop: number;
}

// Los servicios de una cita se suman: duración y precio (reglas de negocio).
export function summarize(
  services: readonly Pick<PublicService, "priceCop" | "durationMinutes">[],
): Selection {
  return services.reduce<Selection>(
    (total, service) => ({
      count: total.count + 1,
      durationMinutes: total.durationMinutes + service.durationMinutes,
      priceCop: total.priceCop + service.priceCop,
    }),
    { count: 0, durationMinutes: 0, priceCop: 0 },
  );
}

// "2 servicios · 2 h 30 min · $100.000"
export function selectionSummary({ count, durationMinutes, priceCop }: Selection): string {
  const services = `${count} ${count === 1 ? "servicio" : "servicios"}`;
  return `${services} · ${formatDuration(durationMinutes)} · ${formatPrice(priceCop)}`;
}
