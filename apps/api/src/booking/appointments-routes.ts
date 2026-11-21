import {
  bookingRequestSchema,
  HISTORY_LIMIT,
  summarize,
  type AppointmentState,
  type BookingResult,
  type MyAppointment,
  type MyAppointments,
} from "@caro/shared";
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { Router } from "express";
import { currentUser } from "../auth/require-user.js";
import type { Database } from "../db/client.js";
import { DEADLOCK, EXCLUSION_VIOLATION, hasPgCode, LOCK_NOT_AVAILABLE } from "../db/errors.js";
import { appointments, appointmentServices, users } from "../db/schema.js";
import { invalidInput } from "../http.js";
import { bogotaDate, bogotaInstant, bogotaTime, MINUTE } from "./dates.js";
import { serviceUnavailable, slotTaken } from "./responses.js";
import { loadActiveServices, offeredTimes } from "./schedule.js";

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

type Row = { id: string; startAt: Date; endAt: Date; status: string; totalPriceCop: number };

// Las citas con sus servicios (la copia guardada al reservar) y su estado para la clienta.
async function withServices(db: Database, rows: Row[], current: Date): Promise<MyAppointment[]> {
  const copies = rows.length
    ? await db
        .select({
          appointmentId: appointmentServices.appointmentId,
          name: appointmentServices.serviceName,
        })
        .from(appointmentServices)
        .where(
          inArray(
            appointmentServices.appointmentId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(asc(appointmentServices.serviceName))
    : [];
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
      services: copies.filter((copy) => copy.appointmentId === row.id).map((copy) => copy.name),
      durationMinutes: (row.endAt.getTime() - row.startAt.getTime()) / MINUTE,
      totalPriceCop: row.totalPriceCop,
      state,
    };
  });
}

export function appointmentsRouter(db: Database, now: () => Date): Router {
  const router = Router();

  // Mis citas (RF07): solo las de la cuenta con sesión.
  router.get("/", async (req, res) => {
    const user = await currentUser(db, req, res);
    if (!user) return;

    const current = now();
    const columns = {
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
      totalPriceCop: appointments.totalPriceCop,
    };
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

    const [upcomingList, historyList] = await Promise.all([
      withServices(db, upcoming, current),
      withServices(db, history, current),
    ]);
    const result: MyAppointments = { upcoming: upcomingList, history: historyList };
    // Son datos personales: que no queden guardados en el navegador ni en intermediarios.
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
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`booking:${date}`}))`);

        // La disponibilidad se vuelve a calcular aquí, dentro del turno: solo vale una hora
        // que el motor ofrece ahora mismo, no la que la página mostró hace un rato.
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
      if (hasPgCode(error, LOCK_NOT_AVAILABLE)) {
        res.status(503).json({ error: "busy" });
        return;
      }
      // Red de seguridad por si algo escribe citas sin el turno: la restricción de exclusión
      // de la base impide la superposición (RF21) y, si dos escrituras se esperaban una a la
      // otra, Postgres corta una con un interbloqueo. Para la clienta es lo mismo.
      if (hasPgCode(error, EXCLUSION_VIOLATION) || hasPgCode(error, DEADLOCK)) {
        return slotTaken(res);
      }
      throw error;
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
    res.status(201).json(result);
  });

  return router;
}
