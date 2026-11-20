import { z } from "zod";
import { onlyKnownFields } from "./strict.js";

// Reservas, compartidas por la API y la web. Los mensajes son textos de UI.

export const MAX_SERVICES_PER_BOOKING = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pickMessage = "Elige al menos un servicio.";

// Los servicios de una cita: uno o varios, sin repetir.
export const serviceIdsSchema = z
  .array(z.string(pickMessage).regex(UUID, pickMessage), pickMessage)
  .min(1, pickMessage)
  .max(MAX_SERVICES_PER_BOOKING, `Elige como máximo ${MAX_SERVICES_PER_BOOKING} servicios.`)
  .refine((ids) => new Set(ids).size === ids.length, "No repitas servicios.");

// Una fecha real del calendario, "AAAA-MM-DD": "2026-02-30" no lo es.
export function isCalendarDate(text: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(text) &&
    new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text
  );
}

const dateMessage = "Elige una fecha válida.";
export const bookingDateSchema = z.string(dateMessage).refine(isCalendarDate, dateMessage);

// Horas libres de un día. Los servicios llegan en la URL separados por comas:
// ?date=2026-11-23&services=id1,id2.
export const bookingTimesQuerySchema = z.object({
  date: bookingDateSchema,
  services: z
    .string(pickMessage)
    .transform((list) => list.split(","))
    .pipe(serviceIdsSchema),
});

export const serviceUnavailableMessage =
  "Alguno de los servicios ya no está disponible. Vuelve a elegirlos.";

const timeMessage = "Elige una hora válida.";

// Reservar: los servicios, el día y la hora de inicio (hora de Bogotá, "HH:MM").
export const bookingRequestSchema = z.strictObject(
  {
    serviceIds: serviceIdsSchema,
    date: bookingDateSchema,
    time: z.string(timeMessage).regex(/^([01]\d|2[0-3]):[0-5]\d$/, timeMessage),
  },
  onlyKnownFields,
);

export type BookingRequest = z.output<typeof bookingRequestSchema>;

export const slotTakenMessage = "Esa hora ya no está disponible. Elige otra.";

// La cita recién confirmada, tal como la ve la clienta.
export interface BookedAppointment {
  id: string;
  date: string;
  time: string;
  services: string[];
  durationMinutes: number;
  totalPriceCop: number;
}

export interface BookingResult {
  appointment: BookedAppointment;
  // Teléfono de Caro en formato E.164 para el enlace de WhatsApp; null si no hay cuenta admin.
  caroWhatsapp: string | null;
}
