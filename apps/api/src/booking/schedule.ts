import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  appointments,
  businessHours,
  scheduleExceptions,
  services,
  settings,
} from "../db/schema.js";
import { availableTimes, bookingWindow, type DaySchedule } from "./availability.js";
import { addDays, bogotaDate, bogotaInstant, isoWeekday } from "./dates.js";

// Lee de la base lo que el motor de disponibilidad necesita. Acepta la base o una
// transacción (la reserva calcula las horas dentro de la suya).
type Reader = Pick<Database, "select">;

export async function loadSettings(db: Reader) {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!row) throw new Error("Falta la fila de settings: corre pnpm db:seed.");
  return row;
}

// Los días de `first` a `last` (fechas de Bogotá, incluidas), cada uno con su horario
// base, las excepciones y las citas agendadas que lo tocan. `exceptId` deja afuera una cita:
// al reprogramarla, su propio horario no cuenta como ocupado.
export async function loadDays(
  db: Reader,
  first: string,
  last: string,
  exceptId?: string,
): Promise<DaySchedule[]> {
  const rangeStart = bogotaInstant(first, "00:00");
  const rangeEnd = bogotaInstant(addDays(last, 1), "00:00");

  const [hours, exceptions, booked] = await Promise.all([
    db.select().from(businessHours),
    db
      .select()
      .from(scheduleExceptions)
      .where(
        and(lt(scheduleExceptions.startsAt, rangeEnd), gt(scheduleExceptions.endsAt, rangeStart)),
      ),
    // Solo las citas agendadas ocupan la agenda.
    db
      .select({ startAt: appointments.startAt, occupiedUntil: appointments.occupiedUntil })
      .from(appointments)
      .where(
        and(
          eq(appointments.status, "scheduled"),
          lt(appointments.startAt, rangeEnd),
          gt(appointments.occupiedUntil, rangeStart),
          exceptId ? ne(appointments.id, exceptId) : undefined,
        ),
      ),
  ]);

  const days: DaySchedule[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const dayStart = bogotaInstant(date, "00:00");
    const dayEnd = bogotaInstant(addDays(date, 1), "00:00");
    const touches = (start: Date, end: Date) => start < dayEnd && end > dayStart;
    days.push({
      date,
      hours: hours.find((row) => row.weekday === isoWeekday(date)),
      exceptions: exceptions.filter((e) => touches(e.startsAt, e.endsAt)),
      appointments: booked.filter((a) => touches(a.startAt, a.occupiedUntil)),
    });
  }
  return days;
}

// Los servicios activos con esos ids. Si falta alguno (no existe o Caro lo desactivó),
// devuelve undefined.
export async function loadActiveServices(db: Database, ids: readonly string[]) {
  const rows = await db
    .select({
      id: services.id,
      name: services.name,
      priceCop: services.priceCop,
      durationMinutes: services.durationMinutes,
    })
    .from(services)
    .where(and(inArray(services.id, [...ids]), eq(services.active, true)));
  // En el orden en que la clienta los eligió.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chosen = ids.flatMap((id) => byId.get(id) ?? []);
  return chosen.length === ids.length ? chosen : undefined;
}

// Horas que el motor ofrece ahora para un día y una duración. Mostrar las horas y
// reservar usan esta misma función: solo se puede reservar una hora que se ofrece.
export async function offeredTimes(
  db: Reader,
  now: () => Date,
  date: string,
  durationMinutes: number,
  // Al reprogramar, la cita que se mueve no se tapa a sí misma.
  exceptId?: string,
) {
  const rules = await loadSettings(db);
  const { first, last } = bookingWindow(bogotaDate(now()), rules);
  if (date < first || date > last) return { rules, times: [] };
  const [day] = await loadDays(db, date, date, exceptId);
  // Con anticipación mínima de 0 días, la fecha puede ser hoy: no se ofrecen horas pasadas.
  const later = (time: string) => bogotaInstant(date, time) > now();
  return { rules, times: day ? availableTimes(day, durationMinutes, rules).filter(later) : [] };
}
