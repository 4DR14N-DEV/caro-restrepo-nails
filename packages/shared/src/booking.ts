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

// Días y horas escritos igual en todos lados, sin depender del idioma del navegador.
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function dateParts(date: string) {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { weekday: WEEKDAYS[weekday] ?? "", day, month: MONTHS[month - 1] ?? "" };
}

// "2026-11-23" → "lunes 23 de noviembre"
export function formatDay(date: string): string {
  const { weekday, day, month } = dateParts(date);
  return `${weekday} ${day} de ${month}`;
}

// "2026-11-23" → "lun 23 nov"
export function formatDayShort(date: string): string {
  const { weekday, day, month } = dateParts(date);
  return `${weekday.slice(0, 3)} ${day} ${month.slice(0, 3)}`;
}

// "14:30" → "2:30 p. m."
export function formatTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "a. m." : "p. m."}`;
}

// ["A", "B", "C"] → "A, B y C"
function joinNames(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}

// "lunes 23 de noviembre a las 10:00 a. m."; con la una se dice "a la".
export function formatWhen(date: string, time: string): string {
  const hour = formatTime(time);
  return `${formatDay(date)} ${hour.startsWith("1:") ? "a la" : "a las"} ${hour}`;
}

// Texto para avisar a Caro: "Hola Caro, soy {nombre}. Reservé {servicios} el {día} a las {hora}."
// La hora termina en "a. m." o "p. m.": ese punto cierra la oración, sin agregar otro.
export function bookingMessage(booking: {
  name: string;
  services: readonly string[];
  date: string;
  time: string;
}): string {
  return `Hola Caro, soy ${booking.name}. Reservé ${joinNames(booking.services)} el ${formatWhen(booking.date, booking.time)}`;
}

// Enlace de WhatsApp con el mensaje ya escrito. El número va sin "+".
export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
}
