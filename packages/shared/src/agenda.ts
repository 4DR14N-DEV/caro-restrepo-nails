import { z } from "zod";
import { bookingDateSchema } from "./booking.js";

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

export interface Agenda {
  appointments: AgendaAppointment[];
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
