import { z } from "zod";
import { EARLIEST_OPENING, quarterTime, type AgendaAppointment } from "./agenda.js";
import { formatTime } from "./booking.js";
import { onlyKnownFields } from "./strict.js";

// Horario base y reglas de reserva que configura Caro (RF15), compartidos por la API y el panel.

// Un día de lunes (1) a sábado (6). Sin horas, ese día no abre.
export interface WeekdayHours {
  weekday: number;
  opensAt: string | null;
  closesAt: string | null;
}

export interface BookingRules {
  // Margen después de cada cita; solo vale para las citas nuevas.
  bufferMinutes: number;
  bookingMinDays: number;
  bookingMaxMonths: number;
  cancelMinHours: number;
  rescheduleMinDays: number;
}

export interface ScheduleSettings {
  hours: WeekdayHours[];
  rules: BookingRules;
}

// Al guardar: las citas agendadas que entraban en el horario anterior y no entran en el nuevo.
export interface ScheduleSaved extends ScheduleSettings {
  outside: AgendaAppointment[];
}

export const LATEST_CLOSING = "21:00";
export const WEEKDAYS = [1, 2, 3, 4, 5, 6] as const;

const pairMessage = "Elige la hora de apertura y la de cierre, o marca el día como cerrado.";

const weekdayHoursSchema = z
  .strictObject(
    {
      weekday: z.number().int(),
      opensAt: quarterTime(pairMessage).nullable(),
      closesAt: quarterTime(pairMessage).nullable(),
    },
    onlyKnownFields,
  )
  .superRefine(({ opensAt, closesAt }, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });
    if ((opensAt === null) !== (closesAt === null)) {
      issue(opensAt === null ? "opensAt" : "closesAt", pairMessage);
      return;
    }
    if (opensAt === null || closesAt === null) return;
    if (opensAt < EARLIEST_OPENING) {
      issue("opensAt", `Se puede abrir desde las ${formatTime(EARLIEST_OPENING)}`);
    }
    if (closesAt > LATEST_CLOSING) {
      issue("closesAt", `Se puede cerrar hasta las ${formatTime(LATEST_CLOSING)}`);
    }
    if (closesAt <= opensAt) {
      issue("closesAt", "La hora de cierre tiene que ser después de la de apertura.");
    }
  });

// Un entero entre min y max (y múltiplo de step), con un solo mensaje para todo.
const bounded = (min: number, max: number, message: string, step = 1) =>
  z
    .number(message)
    .int(message)
    .min(min, message)
    .max(max, message)
    .refine((value) => value % step === 0, message);

export const scheduleSettingsRequestSchema = z.strictObject(
  {
    hours: z
      .array(weekdayHoursSchema)
      .refine(
        (hours) =>
          hours.length === WEEKDAYS.length &&
          WEEKDAYS.every((weekday) => hours.some((day) => day.weekday === weekday)),
        "Manda los seis días, de lunes a sábado.",
      ),
    rules: z.strictObject(
      {
        bufferMinutes: bounded(0, 60, "El margen va de 0 a 60 minutos, en pasos de 5.", 5),
        bookingMinDays: bounded(0, 14, "La anticipación mínima va de 0 a 14 días."),
        bookingMaxMonths: bounded(1, 6, "La anticipación máxima va de 1 a 6 meses."),
        cancelMinHours: bounded(0, 48, "Cancelar va de 0 a 48 horas antes de la cita."),
        rescheduleMinDays: bounded(0, 14, "Reprogramar va de 0 a 14 días antes de la cita."),
      },
      onlyKnownFields,
    ),
  },
  onlyKnownFields,
);

export type ScheduleSettingsRequest = z.output<typeof scheduleSettingsRequestSchema>;

const toMinutes = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

// ¿Una cita que empieza a `time` y dura `durationMinutes` entra en el horario de ese día?
// El margen no se exige al cierre.
export function fitsHours(
  day: WeekdayHours | undefined,
  time: string,
  durationMinutes: number,
): boolean {
  if (!day?.opensAt || !day.closesAt) return false;
  const start = toMinutes(time);
  return start >= toMinutes(day.opensAt) && start + durationMinutes <= toMinutes(day.closesAt);
}

export function outsideHoursMessage(count: number): string {
  return count === 1
    ? "Hay 1 cita agendada fuera del nuevo horario."
    : `Hay ${count} citas agendadas fuera del nuevo horario.`;
}
