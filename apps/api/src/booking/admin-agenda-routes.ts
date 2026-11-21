import {
  agendaQuerySchema,
  appointmentStatusRequestSchema,
  cancelledIsFinalMessage,
  isUuid,
  notStartedMessage,
  onlyScheduledCancelMessage,
  type Agenda,
  type AgendaAppointment,
  type AgendaChange,
} from "@caro/shared";
import { and, asc, eq, gte, inArray, lt, lte, ne, type SQL } from "drizzle-orm";
import { Router, type Response } from "express";
import { requireAdmin } from "../auth/require-admin.js";
import type { Database } from "../db/client.js";
import { appointments, scheduleExceptions, users } from "../db/schema.js";
import { invalidInput } from "../http.js";
import { addDays, bogotaDate, bogotaInstant, bogotaTime, MINUTE } from "./dates.js";
import { toAgendaException } from "./exceptions.js";
import { serviceNamesByAppointment } from "./service-copies.js";

const agendaColumns = {
  id: appointments.id,
  startAt: appointments.startAt,
  endAt: appointments.endAt,
  status: appointments.status,
  totalPriceCop: appointments.totalPriceCop,
  clientName: users.name,
  clientPhone: users.phone,
};

type AgendaRow = {
  id: string;
  startAt: Date;
  endAt: Date;
  status: AgendaAppointment["status"];
  totalPriceCop: number;
  clientName: string;
  clientPhone: string | null;
};

function toAgenda(row: AgendaRow, services: string[], current: Date): AgendaAppointment {
  return {
    id: row.id,
    date: bogotaDate(row.startAt),
    time: bogotaTime(row.startAt),
    services,
    durationMinutes: (row.endAt.getTime() - row.startAt.getTime()) / MINUTE,
    totalPriceCop: row.totalPriceCop,
    status: row.status,
    client: { name: row.clientName, phone: row.clientPhone },
    canMark: row.status !== "cancelled" && row.startAt <= current,
    canCancel: row.status === "scheduled",
  };
}

// Las citas de la agenda que cumplen `where`, en orden de hora, listas para mostrar.
async function loadAgenda(db: Pick<Database, "select">, where: SQL | undefined, current: Date) {
  const rows = await db
    .select(agendaColumns)
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.clientId))
    .where(where)
    .orderBy(asc(appointments.startAt), asc(appointments.id));
  const names = await serviceNamesByAppointment(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toAgenda(row, names.get(row.id) ?? [], current));
}

function statusNotAllowed(res: Response, form: string): void {
  res.status(409).json({ error: "status_not_allowed", fields: { form } });
}

// Panel de Caro: la agenda (RF10). Solo admin.
export function adminAgendaRouter(db: Database, now: () => Date): Router {
  const router = Router();
  router.use(requireAdmin(db));

  router.get("/", async (req, res) => {
    const parsed = agendaQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { from, to } = parsed.data;
    const withCancelled = parsed.data.cancelled === "1";

    const rangeStart = bogotaInstant(from, "00:00");
    const rangeEnd = bogotaInstant(addDays(to, 1), "00:00");
    const current = now();
    const [list, exceptions] = await Promise.all([
      loadAgenda(
        db,
        and(
          gte(appointments.startAt, rangeStart),
          lt(appointments.startAt, rangeEnd),
          withCancelled ? undefined : ne(appointments.status, "cancelled"),
        ),
        current,
      ),
      // Bloqueos, descansos y aperturas más temprano que empiezan en el rango (RF13, RF14).
      db
        .select()
        .from(scheduleExceptions)
        .where(
          and(
            gte(scheduleExceptions.startsAt, rangeStart),
            lt(scheduleExceptions.startsAt, rangeEnd),
          ),
        )
        .orderBy(asc(scheduleExceptions.startsAt), asc(scheduleExceptions.id)),
    ]);
    const result: Agenda = { appointments: list, exceptions: exceptions.map(toAgendaException) };
    // Datos de las clientas: que no queden guardados en ningún lado.
    res.set("Cache-Control", "no-store").json(result);
  });

  return router;
}

// Panel de Caro: marcar cada cita como completada, no asistió o cancelada (RF12). Solo admin.
export function adminAppointmentsRouter(db: Database, now: () => Date): Router {
  const router = Router();
  router.use(requireAdmin(db));

  router.patch("/:id/status", async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const parsed = appointmentStatusRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { status } = parsed.data;
    const current = now();

    // Las condiciones van en el mismo UPDATE, para que dos cambios a la vez no se pisen.
    // Cancelar: solo una agendada, en cualquier momento (sin el plazo de las clientas); libera
    // la hora porque la restricción de exclusión solo mira las agendadas. Completada o no
    // asistió: solo si ya empezó; entre ellas se pueden corregir. Una cancelada no vuelve atrás.
    // La cita que se responde se lee en la misma transacción, así refleja este cambio.
    const { updated, appointment } = await db.transaction(async (tx) => {
      const [changed] =
        status === "cancelled"
          ? await tx
              .update(appointments)
              .set({ status, cancelledBy: "admin", cancelledAt: current, updatedAt: current })
              .where(and(eq(appointments.id, id), eq(appointments.status, "scheduled")))
              .returning({ id: appointments.id })
          : await tx
              .update(appointments)
              .set({ status, updatedAt: current })
              .where(
                and(
                  eq(appointments.id, id),
                  inArray(appointments.status, ["scheduled", "completed", "no_show"]),
                  lte(appointments.startAt, current),
                ),
              )
              .returning({ id: appointments.id });
      const [row] = await loadAgenda(tx, eq(appointments.id, id), current);
      return { updated: changed, appointment: row };
    });

    if (!appointment) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!updated) {
      if (appointment.status === "cancelled") return statusNotAllowed(res, cancelledIsFinalMessage);
      return statusNotAllowed(
        res,
        status === "cancelled" ? onlyScheduledCancelMessage : notStartedMessage,
      );
    }

    const result: AgendaChange = { appointment };
    res.set("Cache-Control", "no-store").json(result);
  });

  return router;
}
