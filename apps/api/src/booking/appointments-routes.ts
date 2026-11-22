import {
  bookingRequestSchema,
  cancelTooLateMessage,
  HISTORY_LIMIT,
  isUuid,
  rescheduleRequestSchema,
  rescheduleTimesQuerySchema,
  rescheduleTooLateMessage,
  summarize,
  type AppointmentChange,
  type AppointmentState,
  type BookingResult,
  type MyAppointment,
  type MyAppointments,
} from "@caro/shared";
import { and, asc, desc, eq, gt, gte, isNotNull, lte, ne, or } from "drizzle-orm";
import { Router, type Response } from "express";
import { holdActiveAccount } from "../auth/delete-account.js";
import { currentUser } from "../auth/require-user.js";
import type { Database } from "../db/client.js";
import { writeConflict } from "../db/errors.js";
import type { NotifyAdmins } from "../push/notify.js";
import { appointments, appointmentServices, users } from "../db/schema.js";
import { invalidInput } from "../http.js";
import { addDays, bogotaDate, bogotaInstant, bogotaTime, MINUTE } from "./dates.js";
import { limitLockWait, lockDay } from "./locks.js";
import { serviceUnavailable, slotTaken } from "./responses.js";
import { serviceNamesByAppointment } from "./service-copies.js";
import { loadActiveServices, loadSettings, offeredTimes } from "./schedule.js";

const HOUR = 60 * MINUTE;

// La reserva se rindió porque la cuenta se borró mientras tanto.
const ACCOUNT_GONE = "account_gone";

type Rules = Awaited<ReturnType<typeof loadSettings>>;

// Teléfono de la cuenta de Caro para el botón de WhatsApp (la primera admin creada).
async function caroPhone(db: Database): Promise<string | null> {
  const [caro] = await db
    .select({ phone: users.phone })
    .from(users)
    .where(and(eq(users.role, "admin"), isNotNull(users.phone)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return caro?.phone ?? null;
}

// Lo que se lee de cada cita para mostrarla.
const appointmentColumns = {
  id: appointments.id,
  startAt: appointments.startAt,
  endAt: appointments.endAt,
  status: appointments.status,
  totalPriceCop: appointments.totalPriceCop,
};

type Row = { id: string; startAt: Date; endAt: Date; status: string; totalPriceCop: number };

// Cancelar se puede hasta `cancel_min_hours` antes (con las horas justas todavía se puede).
// Esta es la hora de inicio más temprana que todavía se puede cancelar.
const cancelDeadline = (current: Date, rules: Rules) =>
  new Date(current.getTime() + rules.cancelMinHours * HOUR);

// Reprogramar se puede si faltan `reschedule_min_days` días o más, contados por fechas de
// Bogotá como la ventana de reserva.
const canRescheduleOn = (startAt: Date, current: Date, rules: Rules) =>
  bogotaDate(startAt) >= addDays(bogotaDate(current), rules.rescheduleMinDays);

// Una cita se puede reprogramar si está agendada, todavía no empezó y faltan los días mínimos.
const movable = (row: Row, current: Date, rules: Rules) =>
  row.status === "scheduled" &&
  row.startAt > current &&
  canRescheduleOn(row.startAt, current, rules);

const minutesOf = (row: Row) => (row.endAt.getTime() - row.startAt.getTime()) / MINUTE;

function notFound(res: Response): void {
  res.status(404).json({ error: "not_found" });
}

function rescheduleTooLate(res: Response): void {
  res
    .status(409)
    .json({ error: "reschedule_too_late", fields: { form: rescheduleTooLateMessage } });
}

// Errores al guardar una cita con los turnos tomados. Devuelve true si ya respondió. Para la
// clienta, una superposición frenada por la base es lo mismo que una hora ya tomada.
function answeredWriteError(error: unknown, res: Response): boolean {
  const kind = writeConflict(error);
  if (kind === "busy") res.status(503).json({ error: "busy" });
  if (kind === "clash") slotTaken(res);
  return kind !== undefined;
}

// Una cita de la clienta, en cualquier estado; undefined si no existe o es de otra persona.
async function loadOwn(db: Pick<Database, "select">, id: string, clientId: string) {
  const [row] = await db
    .select(appointmentColumns)
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.clientId, clientId)));
  return row;
}

// Las citas con sus servicios (la copia guardada al reservar), su estado para la clienta y
// lo que todavía puede hacer con ellas.
async function withServices(
  db: Database,
  rows: Row[],
  current: Date,
  rules: Rules,
): Promise<MyAppointment[]> {
  const names = await serviceNamesByAppointment(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const state: AppointmentState =
      row.status === "scheduled"
        ? row.startAt > current
          ? "upcoming"
          : "past"
        : (row.status as AppointmentState);
    return {
      id: row.id,
      date: bogotaDate(row.startAt),
      time: bogotaTime(row.startAt),
      services: names.get(row.id) ?? [],
      durationMinutes: minutesOf(row),
      totalPriceCop: row.totalPriceCop,
      state,
      canCancel: state === "upcoming" && row.startAt >= cancelDeadline(current, rules),
      canReschedule: movable(row, current, rules),
    };
  });
}

export function appointmentsRouter(
  db: Database,
  now: () => Date,
  notifyAdmins: NotifyAdmins = async () => {},
): Router {
  const router = Router();

  // Mis citas (RF07): solo las de la cuenta con sesión.
  router.get("/", async (req, res) => {
    const user = await currentUser(db, req, res);
    if (!user) return;

    const current = now();
    const columns = appointmentColumns;
    const mine = eq(appointments.clientId, user.id);
    const [upcoming, history] = await Promise.all([
      db
        .select(columns)
        .from(appointments)
        .where(and(mine, eq(appointments.status, "scheduled"), gt(appointments.startAt, current)))
        .orderBy(asc(appointments.startAt)),
      db
        .select(columns)
        .from(appointments)
        .where(
          and(mine, or(ne(appointments.status, "scheduled"), lte(appointments.startAt, current))),
        )
        // Una cita cancelada y la que la reemplazó pueden tener la misma hora: se desempata
        // por la más nueva, para que el orden (y el corte en 20) no cambie entre consultas.
        .orderBy(desc(appointments.startAt), desc(appointments.createdAt), desc(appointments.id))
        .limit(HISTORY_LIMIT),
    ]);

    const rules = await loadSettings(db);
    const [upcomingList, historyList] = await Promise.all([
      withServices(db, upcoming, current, rules),
      withServices(db, history, current, rules),
    ]);
    const result: MyAppointments = { upcoming: upcomingList, history: historyList };
    // Son datos personales: que no queden guardados en el navegador ni en intermediarios.
    res.set("Cache-Control", "no-store").json(result);
  });

  // Cancelar (RF08): solo una cita propia y agendada, hasta `cancel_min_hours` antes.
  router.post("/:id/cancel", async (req, res) => {
    const user = await currentUser(db, req, res);
    if (!user) return;
    const { id } = req.params;
    if (!isUuid(id)) return notFound(res);

    const [rules, caroWhatsapp] = await Promise.all([loadSettings(db), caroPhone(db)]);
    const current = now();
    // Todas las condiciones van en el mismo UPDATE: dos cancelaciones a la vez, o una justo
    // al vencer el plazo, no se cuelan. Cancelar libera la hora: la restricción de exclusión
    // solo mira las citas agendadas.
    const [row] = await db
      .update(appointments)
      .set({
        status: "cancelled",
        cancelledBy: user.role,
        cancelledAt: current,
        updatedAt: current,
      })
      .where(
        and(
          eq(appointments.id, id),
          eq(appointments.clientId, user.id),
          eq(appointments.status, "scheduled"),
          // Que no haya empezado, aunque el plazo de cancelación sea 0 (igual que `canCancel`).
          gt(appointments.startAt, current),
          gte(appointments.startAt, cancelDeadline(current, rules)),
        ),
      )
      .returning(appointmentColumns);

    if (!row) {
      // No se canceló: o no es una cita suya (404, sin decir si existe), o ya no se puede.
      if (!(await loadOwn(db, id, user.id))) return notFound(res);
      res.status(409).json({ error: "cancel_too_late", fields: { form: cancelTooLateMessage } });
      return;
    }

    const [appointment] = await withServices(db, [row], current, rules);
    if (!appointment) throw new Error("No se leyó la cita cancelada.");
    await notifyAdmins([
      {
        kind: "cancelled",
        clientName: user.name,
        services: appointment.services,
        date: appointment.date,
        time: appointment.time,
      },
    ]);
    const result: AppointmentChange = { appointment, caroWhatsapp };
    // Datos personales, como en la lista: que no queden guardados en ningún lado.
    res.set("Cache-Control", "no-store").json(result);
  });

  // Horas libres de un día para mover una cita propia, con su duración y sin que su propio
  // horario cuente como ocupado.
  router.get("/:id/times", async (req, res) => {
    const user = await currentUser(db, req, res);
    if (!user) return;
    const { id } = req.params;
    if (!isUuid(id)) return notFound(res);
    const parsed = rescheduleTimesQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalidInput(res, parsed.error);

    const own = await loadOwn(db, id, user.id);
    if (!own) return notFound(res);
    const rules = await loadSettings(db);
    if (!movable(own, now(), rules)) return rescheduleTooLate(res);

    const { times } = await offeredTimes(db, now, parsed.data.date, minutesOf(own), own.id);
    res.json({ times });
  });

  // Reprogramar (RF09): se mueve la misma cita, con sus servicios y precios, si faltan los
  // días mínimos y la hora nueva está libre dentro de la ventana de reserva.
  router.patch("/:id", async (req, res) => {
    const user = await currentUser(db, req, res);
    if (!user) return;
    const { id } = req.params;
    if (!isUuid(id)) return notFound(res);
    const parsed = rescheduleRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { date, time } = parsed.data;

    const own = await loadOwn(db, id, user.id);
    if (!own) return notFound(res);
    const [rules, caroWhatsapp] = await Promise.all([loadSettings(db), caroPhone(db)]);
    if (!movable(own, now(), rules)) return rescheduleTooLate(res);

    let outcome: { moved: Row } | "too_late" | "slot_taken";
    try {
      outcome = await db.transaction(async (tx) => {
        await limitLockWait(tx);
        // Turnos del día viejo y del nuevo, siempre en orden de fecha: dos reprogramaciones
        // cruzadas (lunes → martes y martes → lunes) los toman igual y no se traban.
        for (const day of [...new Set([bogotaDate(own.startAt), date])].sort()) {
          await lockDay(tx, day);
        }

        // Se vuelve a leer con los turnos tomados: pudo cancelarse o moverse mientras tanto.
        const [fresh] = await tx
          .select(appointmentColumns)
          .from(appointments)
          .where(and(eq(appointments.id, id), eq(appointments.clientId, user.id)))
          .for("update");
        if (!fresh || !movable(fresh, now(), rules)) return "too_late";

        const duration = minutesOf(fresh);
        const { times } = await offeredTimes(tx, now, date, duration, id);
        if (!times.includes(time)) return "slot_taken";

        const startAt = bogotaInstant(date, time);
        const endAt = new Date(startAt.getTime() + duration * MINUTE);
        const [moved] = await tx
          .update(appointments)
          .set({
            startAt,
            endAt,
            occupiedUntil: new Date(endAt.getTime() + rules.bufferMinutes * MINUTE),
            updatedAt: now(),
          })
          .where(eq(appointments.id, id))
          .returning(appointmentColumns);
        if (!moved) throw new Error("No se movió la cita.");
        return { moved };
      });
    } catch (error) {
      if (answeredWriteError(error, res)) return;
      throw error;
    }
    if (outcome === "too_late") return rescheduleTooLate(res);
    if (outcome === "slot_taken") return slotTaken(res);

    const [appointment] = await withServices(db, [outcome.moved], now(), rules);
    if (!appointment) throw new Error("No se leyó la cita reprogramada.");
    await notifyAdmins([
      {
        kind: "rescheduled",
        clientName: user.name,
        services: appointment.services,
        from: { date: bogotaDate(own.startAt), time: bogotaTime(own.startAt) },
        date: appointment.date,
        time: appointment.time,
      },
    ]);
    const result: AppointmentChange = { appointment, caroWhatsapp };
    res.set("Cache-Control", "no-store").json(result);
  });

  // Reservar (RF06): la cita queda confirmada al instante si la hora está libre.

  router.post("/", async (req, res) => {
    const user = await currentUser(db, req, res);
    if (!user) return;

    const parsed = bookingRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { serviceIds, date, time } = parsed.data;

    const chosen = await loadActiveServices(db, serviceIds);
    if (!chosen) return serviceUnavailable(res);
    const { durationMinutes, priceCop } = summarize(chosen);

    // Se busca antes de guardar: después del commit, un fallo de esta lectura daría un
    // error a una clienta cuya cita sí quedó guardada.
    const caroWhatsapp = await caroPhone(db);

    let id: string | undefined;
    try {
      id = await db.transaction(async (tx) => {
        // Turno del día: las reservas de una misma fecha se guardan de a una. La segunda
        // espera a que la primera termine y calcula las horas ya con esa cita, así que no
        // hay carreras ni interbloqueos entre reservas. La espera tiene un tope: si el turno
        // no se libera a tiempo, la reserva se rinde en vez de ocupar una conexión sin fin.
        await limitLockWait(tx);
        await lockDay(tx, date);

        // La disponibilidad se vuelve a calcular aquí, dentro del turno: solo vale una hora
        // que el motor ofrece ahora mismo, no la que la página mostró hace un rato.
        // La cuenta sigue activa: si la clienta la borra desde otro dispositivo a la vez, la
        // cita no queda agendada a nombre de nadie (RF22).
        if (!(await holdActiveAccount(tx, user.id))) return ACCOUNT_GONE;

        const { rules, times } = await offeredTimes(tx, now, date, durationMinutes);
        if (!times.includes(time)) return undefined;

        const startAt = bogotaInstant(date, time);
        const endAt = new Date(startAt.getTime() + durationMinutes * MINUTE);
        const occupiedUntil = new Date(endAt.getTime() + rules.bufferMinutes * MINUTE);
        const [appointment] = await tx
          .insert(appointments)
          .values({
            clientId: user.id,
            startAt,
            endAt,
            occupiedUntil,
            totalPriceCop: priceCop,
            createdBy: user.role,
          })
          .returning({ id: appointments.id });
        if (!appointment) throw new Error("No se guardó la cita.");
        // Copia de cada servicio: si Caro cambia el precio, esta cita no cambia.
        await tx.insert(appointmentServices).values(
          chosen.map((service) => ({
            appointmentId: appointment.id,
            serviceId: service.id,
            serviceName: service.name,
            priceCop: service.priceCop,
            durationMinutes: service.durationMinutes,
          })),
        );
        return appointment.id;
      });
    } catch (error) {
      if (answeredWriteError(error, res)) return;
      throw error;
    }
    if (id === ACCOUNT_GONE) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!id) return slotTaken(res);

    const result: BookingResult = {
      appointment: {
        id,
        date,
        time,
        services: chosen.map((service) => service.name),
        durationMinutes,
        totalPriceCop: priceCop,
      },
      caroWhatsapp,
    };
    await notifyAdmins([
      {
        kind: "booked",
        clientName: user.name,
        services: result.appointment.services,
        date,
        time,
      },
    ]);
    res.status(201).json(result);
  });

  return router;
}
