import { addDays, addMonths, bogotaInstant, bogotaTime, MINUTE } from "./dates.js";
import { isClosedDay } from "./holidays.js";

// Motor de disponibilidad (RF05): qué horas de inicio se ofrecen un día para un bloque
// de cierta duración. Es puro: recibe el día ya cargado de la base.

export interface DaySchedule {
  // Fecha de Bogotá, "AAAA-MM-DD".
  date: string;
  // Horario base de ese día de la semana; sin horario, el día no abre.
  hours: { opensAt: string; closesAt: string } | undefined;
  exceptions: { kind: "block" | "break" | "extra_open"; startsAt: Date; endsAt: Date }[];
  // Solo las citas que ocupan la agenda (`scheduled`). `occupiedUntil` = fin + margen.
  appointments: { startAt: Date; occupiedUntil: Date }[];
}

export interface Rules {
  bufferMinutes: number;
  slotStepMinutes: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

// Ventana de reserva por fechas de Bogotá: desde `bookingMinDays` días después de hoy
// hasta `bookingMaxMonths` meses de calendario después de hoy, ambos incluidos.
export function bookingWindow(
  today: string,
  settings: { bookingMinDays: number; bookingMaxMonths: number },
): { first: string; last: string } {
  return {
    first: addDays(today, settings.bookingMinDays),
    last: addMonths(today, settings.bookingMaxMonths),
  };
}

type Span = [number, number];

// Une tramos que se tocan o se pisan. Devuelve los tramos en orden.
function merge(spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

// Quita de los tramos abiertos los tramos cerrados (bloqueos y descansos).
function subtract(open: Span[], closed: Span[]): Span[] {
  return closed.reduce(
    (spans, [closedStart, closedEnd]) =>
      spans.flatMap(([start, end]): Span[] =>
        closedEnd <= start || closedStart >= end
          ? [[start, end]]
          : [
              ...(start < closedStart ? [[start, closedStart] as Span] : []),
              ...(closedEnd < end ? [[closedEnd, end] as Span] : []),
            ],
      ),
    open,
  );
}

function openSpans(day: DaySchedule): Span[] {
  const dayStart = bogotaInstant(day.date, "00:00").getTime();
  const dayEnd = bogotaInstant(addDays(day.date, 1), "00:00").getTime();
  // Solo cuenta la parte de cada excepción que cae en este día.
  const within = (kind: DaySchedule["exceptions"][number]["kind"]) =>
    day.exceptions
      .filter((exception) => exception.kind === kind)
      .map((e): Span => [
        Math.max(e.startsAt.getTime(), dayStart),
        Math.min(e.endsAt.getTime(), dayEnd),
      ])
      .filter(([start, end]) => start < end);

  // Domingos y festivos no abren por horario base (RF20); una apertura extra de Caro sí cuenta.
  const base: Span[] =
    day.hours && !isClosedDay(day.date)
      ? [
          [
            bogotaInstant(day.date, day.hours.opensAt).getTime(),
            bogotaInstant(day.date, day.hours.closesAt).getTime(),
          ],
        ]
      : [];
  const open = merge([...base, ...within("extra_open")]);
  return subtract(open, merge([...within("block"), ...within("break")]));
}

// Tramos en los que Caro atiende ese día, ya sin bloqueos ni descansos.
export function openIntervals(day: DaySchedule): Interval[] {
  return openSpans(day).map(([start, end]) => ({ start: new Date(start), end: new Date(end) }));
}

// Horas de inicio ("HH:MM", hora de Bogotá) en las que entra un bloque de `durationMinutes`:
// cada `slotStepMinutes` en la grilla del día (9:00, 9:30…), más el inicio de cada tramo y la
// hora justo después de cada cita (fin + margen). El bloque tiene que terminar dentro del tramo; el margen no se exige al
// cierre ni antes de un bloqueo o descanso, pero sí antes de otra cita.
export function availableTimes(day: DaySchedule, durationMinutes: number, rules: Rules): string[] {
  const duration = durationMinutes * MINUTE;
  const buffer = rules.bufferMinutes * MINUTE;
  const step = rules.slotStepMinutes * MINUTE;
  const booked = day.appointments.map((a): Span => [
    a.startAt.getTime(),
    a.occupiedUntil.getTime(),
  ]);
  const afterAppointments = booked.map(([, occupiedUntil]) => occupiedUntil);
  // La grilla cuenta desde la medianoche del día: con pasos de 30 minutos queda en las horas
  // en punto y las y media, aunque un tramo abra a una hora no redonda.
  const midnight = bogotaInstant(day.date, "00:00").getTime();

  const starts = new Set<number>();
  for (const [open, close] of openSpans(day)) {
    // El inicio de cada tramo (la apertura, o el fin de un bloqueo o descanso) también se
    // ofrece, como la hora justo después de una cita.
    const candidates = [...afterAppointments, open];
    const firstOnGrid = midnight + Math.ceil((open - midnight) / step) * step;
    for (let start = firstOnGrid; start < close; start += step) candidates.push(start);

    for (const start of candidates) {
      const fits = start >= open && start + duration <= close;
      const free = booked.every(([from, to]) => start + duration + buffer <= from || start >= to);
      if (fits && free) starts.add(start);
    }
  }

  return [...starts].sort((a, b) => a - b).map((start) => bogotaTime(new Date(start)));
}
