import { z } from "zod";
import { bookingDateSchema } from "./booking.js";
import { onlyKnownFields } from "./strict.js";

// Agenda de Caro (RF10, RF12), compartida por la API y el panel.

export type AppointmentStatus = "scheduled" | "completed" | "no_show" | "cancelled";

export interface AgendaAppointment {
  id: string;
  date: string;
  time: string;
  services: string[];
  durationMinutes: number;
  totalPriceCop: number;
  status: AppointmentStatus;
  // Sin celular si la clienta borró su cuenta (queda anonimizada).
  client: { name: string; phone: string | null };
  // Completada o "no asistió": solo cuando la cita ya empezó y no está cancelada.
  canMark: boolean;
  // Cancelar: solo si está agendada.
  canCancel: boolean;
}

// Lo que Caro carga para un día (RF13, RF14). Un bloqueo de todo el día va de 00:00 a 24:00.
export type ExceptionKind = "block" | "break" | "extra_open";

export interface AgendaException {
  id: string;
  date: string;
  kind: ExceptionKind;
  from: string;
  to: string;
  allDay: boolean;
  // Solo para Caro; las clientas nunca lo ven.
  reason: string | null;
}

export interface Agenda {
  appointments: AgendaAppointment[];
  exceptions: AgendaException[];
}

// Un mes en el calendario ocupa hasta 6 semanas.
export const AGENDA_MAX_DAYS = 42;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;

// ?from=2026-11-23&to=2026-11-28&cancelled=1 (las canceladas solo con 1; 0 o sin el
// parámetro, no).
export const agendaQuerySchema = z
  .object({
    from: bookingDateSchema,
    to: bookingDateSchema,
    cancelled: z.enum(["0", "1"], "Usa 0 o 1 para mostrar las canceladas.").optional(),
  })
  .refine(({ from, to }) => to >= from, {
    message: "La fecha final no puede ser anterior a la inicial.",
    path: ["to"],
  })
  .refine(({ from, to }) => daysBetween(from, to) < AGENDA_MAX_DAYS, {
    message: `Elige un rango de hasta ${AGENDA_MAX_DAYS} días.`,
    path: ["to"],
  });

// Marcar una cita (RF12). "Agendada" no se elige: es el estado de partida.
export const appointmentStatusRequestSchema = z.strictObject(
  {
    status: z.enum(
      ["completed", "no_show", "cancelled"],
      "Elige completada, no asistió o cancelada.",
    ),
  },
  onlyKnownFields,
);

export type MarkedStatus = z.output<typeof appointmentStatusRequestSchema>["status"];

export interface AgendaChange {
  appointment: AgendaAppointment;
}

export const notStartedMessage = "Solo puedes marcarla cuando la cita ya empezó.";
export const cancelledIsFinalMessage = "Esta cita está cancelada y no se puede cambiar.";
export const onlyScheduledCancelMessage = "Solo se puede cancelar una cita agendada.";

const quarterMessage = "Elige una hora en múltiplos de 15 minutos.";
const quarterTime = (missing: string) =>
  z.string(missing).regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, quarterMessage);
const startMessage = "Elige la hora de inicio.";
const endMessage = "Elige la hora de fin.";

export const EARLIEST_OPENING = "08:00";
export const REASON_MAX_LENGTH = 100;

// Cargar algo en el horario de un día. "block_day" bloquea el día entero; "block" y
// "break" piden desde y hasta; "extra_open" pide solo desde (hasta la apertura habitual).
export const exceptionRequestSchema = z
  .strictObject(
    {
      date: bookingDateSchema,
      kind: z.enum(["block_day", "block", "break", "extra_open"], "Elige qué quieres cargar."),
      from: quarterTime(startMessage).optional(),
      to: quarterTime(endMessage).optional(),
      reason: z
        .string()
        .trim()
        .max(REASON_MAX_LENGTH, `El motivo puede tener hasta ${REASON_MAX_LENGTH} caracteres.`)
        .optional(),
    },
    onlyKnownFields,
  )
  .superRefine((input, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });
    if (input.kind === "block" || input.kind === "break") {
      if (!input.from) issue("from", startMessage);
      if (!input.to) issue("to", endMessage);
      if (input.from && input.to && input.to <= input.from) {
        issue("to", "La hora de fin tiene que ser después de la de inicio.");
      }
    }
    if (input.kind === "extra_open") {
      if (!input.from) issue("from", startMessage);
      else if (input.from < EARLIEST_OPENING) issue("from", "Se puede abrir desde las 8:00.");
    }
  });

export type ExceptionRequest = z.output<typeof exceptionRequestSchema>;

export interface ExceptionResult {
  exception: AgendaException;
}

export const exceptionConflictMessage =
  "Ya hay citas en esa franja. Muévelas o cancélalas primero.";
export const pastDayMessage = "No se puede cambiar el horario de un día que ya pasó.";
export const closedDayMessage = "Ese día no abre: no se puede abrir más temprano.";
