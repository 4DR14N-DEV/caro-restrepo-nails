import {
  closedDayMessage,
  exceptionConflictMessage,
  exceptionRequestSchema,
  formatTime,
  isUuid,
  pastDayMessage,
  type ExceptionResult,
} from "@caro/shared";
import { and, eq, gt, lt } from "drizzle-orm";
import { Router, type Response } from "express";
import { requireAdmin } from "../auth/require-admin.js";
import type { Database } from "../db/client.js";
import { hasPgCode, LOCK_NOT_AVAILABLE } from "../db/errors.js";
import { appointments, businessHours, scheduleExceptions } from "../db/schema.js";
import { invalidInput } from "../http.js";
import { addDays, bogotaDate, bogotaInstant, isoWeekday } from "./dates.js";
import { toAgendaException } from "./exceptions.js";
import { isClosedDay } from "./holidays.js";
import { limitLockWait, lockDay } from "./locks.js";

function conflict(res: Response, error: string, form: string): void {
  res.status(409).json({ error, fields: { form } });
}

// Panel de Caro: bloqueos, descansos (RF13) y aperturas más temprano (RF14), día por día.
// Solo admin.
export function adminExceptionsRouter(db: Database, now: () => Date): Router {
  const router = Router();
  router.use(requireAdmin(db));

  router.post("/", async (req, res) => {
    const parsed = exceptionRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { date, kind, from, to } = parsed.data;
    const reason = parsed.data.reason || null;

    // El pasado no se toca.
    if (date < bogotaDate(now())) return conflict(res, "past_day", pastDayMessage);

    let startsAt: Date;
    let endsAt: Date;
    if (kind === "block_day") {
      startsAt = bogotaInstant(date, "00:00");
      endsAt = bogotaInstant(addDays(date, 1), "00:00");
    } else if (kind === "extra_open") {
      // Desde la hora elegida hasta la apertura habitual; solo los días que abren.
      const [hours] = await db
        .select()
        .from(businessHours)
        .where(eq(businessHours.weekday, isoWeekday(date)));
      if (!hours || isClosedDay(date)) return conflict(res, "closed_day", closedDayMessage);
      const opening = hours.opensAt.slice(0, 5);
      if ((from ?? "") >= opening) {
        return conflict(
          res,
          "not_earlier",
          `Elige una hora antes de la apertura de ese día (${formatTime(opening)}).`,
        );
      }
      startsAt = bogotaInstant(date, from ?? opening);
      endsAt = bogotaInstant(date, opening);
    } else {
      startsAt = bogotaInstant(date, from ?? "00:00");
      endsAt = bogotaInstant(date, to ?? "00:00");
    }
    const closes = kind !== "extra_open";

    let saved: Parameters<typeof toAgendaException>[0] | "conflict";
    try {
      saved = await db.transaction(async (tx) => {
        // El turno del día, el mismo de las reservas: ninguna clienta reserva en la franja
        // entre la revisión de abajo y el guardado.
        await limitLockWait(tx);
        await lockDay(tx, date);

        // Un bloqueo o descanso no puede pisar citas agendadas. Se mira la cita en sí, sin
        // su margen: el margen no se exige antes de un bloqueo o descanso.
        if (closes) {
          const [overlapping] = await tx
            .select({ id: appointments.id })
            .from(appointments)
            .where(
              and(
                eq(appointments.status, "scheduled"),
                lt(appointments.startAt, endsAt),
                gt(appointments.endAt, startsAt),
              ),
            )
            .limit(1);
          if (overlapping) return "conflict";
        }

        const [row] = await tx
          .insert(scheduleExceptions)
          .values({ kind: kind === "block_day" ? "block" : kind, startsAt, endsAt, reason })
          .returning();
        if (!row) throw new Error("No se guardó el horario.");
        return row;
      });
    } catch (error) {
      if (hasPgCode(error, LOCK_NOT_AVAILABLE)) {
        res.status(503).json({ error: "busy" });
        return;
      }
      throw error;
    }
    if (saved === "conflict") {
      return conflict(res, "exception_conflict", exceptionConflictMessage);
    }

    const result: ExceptionResult = { exception: toAgendaException(saved) };
    res.status(201).set("Cache-Control", "no-store").json(result);
  });

  // Quitar algo cargado: las horas vuelven a ofrecerse solas. Toma el turno del día porque
  // quitar una apertura más temprano también cambia qué horas están libres.
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const [row] = await db.select().from(scheduleExceptions).where(eq(scheduleExceptions.id, id));
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const date = bogotaDate(row.startsAt);
    if (date < bogotaDate(now())) return conflict(res, "past_day", pastDayMessage);

    try {
      await db.transaction(async (tx) => {
        await limitLockWait(tx);
        await lockDay(tx, date);
        await tx.delete(scheduleExceptions).where(eq(scheduleExceptions.id, id));
      });
    } catch (error) {
      if (hasPgCode(error, LOCK_NOT_AVAILABLE)) {
        res.status(503).json({ error: "busy" });
        return;
      }
      throw error;
    }
    res.status(204).end();
  });

  return router;
}
