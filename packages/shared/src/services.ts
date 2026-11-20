// Servicios del catálogo, compartidos por la API y la web.

// Servicio tal como lo muestra el catálogo público.
export interface PublicService {
  id: string;
  name: string;
  priceCop: number;
  durationMinutes: number;
}

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
