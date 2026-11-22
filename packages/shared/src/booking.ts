import { z } from "zod";
import { onlyKnownFields } from "./strict.js";

// Reservas, compartidas por la API y la web. Los mensajes son textos de UI.

export const MAX_SERVICES_PER_BOOKING = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Un id de la base (uuid). Las rutas con id en la URL lo revisan antes de consultar.
export function isUuid(text: string): boolean {
  return UUID.test(text);
}
const pickMessage = "Elige al menos un servicio.";

// Los servicios de una cita: uno o varios, sin repetir. Los ids se pasan a minúsculas,
// como los guarda la base, para que "ABC…" y "abc…" sean el mismo servicio.
export const serviceIdsSchema = z
  .array(
    z
      .string(pickMessage)
      .regex(UUID, pickMessage)
      .transform((id) => id.toLowerCase()),
    pickMessage,
  )
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
// Hora de inicio en hora de Bogotá, "HH:MM".
const bookingTimeSchema = z.string(timeMessage).regex(/^([01]\d|2[0-3]):[0-5]\d$/, timeMessage);

// Reservar: los servicios, el día y la hora de inicio.
export const bookingRequestSchema = z.strictObject(
  { serviceIds: serviceIdsSchema, date: bookingDateSchema, time: bookingTimeSchema },
  onlyKnownFields,
);

// Reprogramar: solo el día y la hora nuevos; los servicios no cambian.
export const rescheduleRequestSchema = z.strictObject(
  { date: bookingDateSchema, time: bookingTimeSchema },
  onlyKnownFields,
);

// Horas libres de un día para mover una cita (la duración sale de la cita).
export const rescheduleTimesQuerySchema = z.object({ date: bookingDateSchema });

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

// Estado de una cita en "Mis citas". `past`: agendada, ya pasó y Caro todavía no la marcó.
export type AppointmentState = "upcoming" | "past" | "completed" | "no_show" | "cancelled";

// Una cita de la clienta, con los servicios y precios del momento en que reservó.
export interface MyAppointment {
  id: string;
  date: string;
  time: string;
  services: string[];
  durationMinutes: number;
  totalPriceCop: number;
  state: AppointmentState;
  // Si la clienta todavía puede cancelarla o reprogramarla (reglas de `settings`).
  canCancel: boolean;
  canReschedule: boolean;
}

// Una cita recién cancelada o reprogramada, con el teléfono de Caro para avisarle.
export interface AppointmentChange {
  appointment: MyAppointment;
  caroWhatsapp: string | null;
}

export const cancelTooLateMessage =
  "Ya no se puede cancelar esta cita. Escríbele a Caro por WhatsApp.";

export const rescheduleTooLateMessage =
  "Ya no se puede reprogramar esta cita. Escríbele a Caro por WhatsApp.";

export interface MyAppointments {
  // Agendadas que todavía no empiezan, de la más cercana a la más lejana.
  upcoming: MyAppointment[];
  // El resto, de la más reciente a la más vieja.
  history: MyAppointment[];
}

export const HISTORY_LIMIT = 20;

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

// "2026-11-23" → "noviembre de 2026"
export function formatMonth(date: string): string {
  return `${dateParts(date).month} de ${date.slice(0, 4)}`;
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
export function joinNames(names: readonly string[]): string {
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

// "Hola Caro, soy {nombre}. Cancelé mi cita de {servicios} del {día} a las {hora}"
export function cancelMessage(appointment: {
  name: string;
  services: readonly string[];
  date: string;
  time: string;
}): string {
  return `Hola Caro, soy ${appointment.name}. Cancelé mi cita de ${joinNames(appointment.services)} del ${formatWhen(appointment.date, appointment.time)}`;
}

// "Hola Caro, soy {nombre}. Moví mi cita de {servicios} del {día} a las {hora} al {día} a las {hora}"
export function rescheduleMessage(change: {
  name: string;
  services: readonly string[];
  from: { date: string; time: string };
  to: { date: string; time: string };
}): string {
  const from = formatWhen(change.from.date, change.from.time);
  const to = formatWhen(change.to.date, change.to.time);
  return `Hola Caro, soy ${change.name}. Moví mi cita de ${joinNames(change.services)} del ${from} al ${to}`;
}

// Mensajes de Caro a la clienta. La hora termina en "a. m." o "p. m.": ese punto cierra la
// oración, sin agregar otro.

// "Hola {nombre}, soy Caro. Tuve que cancelar tu cita de {servicios} del {día} a las {hora}.
// Escríbeme para buscar otro horario."
export function adminCancelMessage(appointment: {
  clientName: string;
  services: readonly string[];
  date: string;
  time: string;
}): string {
  return `Hola ${appointment.clientName}, soy Caro. Tuve que cancelar tu cita de ${joinNames(appointment.services)} del ${formatWhen(appointment.date, appointment.time)} Escríbeme para buscar otro horario.`;
}

// "Hola {nombre}, te recuerdo tu cita de {servicios} el {día} a las {hora}. ¡Te espero!"
export function reminderMessage(appointment: {
  clientName: string;
  services: readonly string[];
  date: string;
  time: string;
}): string {
  return `Hola ${appointment.clientName}, te recuerdo tu cita de ${joinNames(appointment.services)} el ${formatWhen(appointment.date, appointment.time)} ¡Te espero!`;
}

type AdminMessageInput = {
  clientName: string;
  services: readonly string[];
  date: string;
  time: string;
};

// "Hola {nombre}, soy Caro. Te agendé {servicios} el {día} a las {hora}. ¡Te espero!"
export function adminBookedMessage(appointment: AdminMessageInput): string {
  return `Hola ${appointment.clientName}, soy Caro. Te agendé ${joinNames(appointment.services)} el ${formatWhen(appointment.date, appointment.time)} ¡Te espero!`;
}

// "Hola {nombre}, soy Caro. Moví tu cita de {servicios} al {día} a las {hora}. ¡Te espero!"
export function adminMovedMessage(appointment: AdminMessageInput): string {
  return `Hola ${appointment.clientName}, soy Caro. Moví tu cita de ${joinNames(appointment.services)} al ${formatWhen(appointment.date, appointment.time)} ¡Te espero!`;
}

// Enlace de WhatsApp con el mensaje ya escrito. El número va sin "+".
export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
}
