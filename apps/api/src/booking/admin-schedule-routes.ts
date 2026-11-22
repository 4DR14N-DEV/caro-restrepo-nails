import {
  fitsHours,
  scheduleSettingsRequestSchema,
  WEEKDAYS,
  type ScheduleSaved,
  type ScheduleSettings,
  type WeekdayHours,
} from "@caro/shared";
import { and, eq, gte } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin } from "../auth/require-admin.js";
import type { Database } from "../db/client.js";
import { appointments, businessHours, settings } from "../db/schema.js";
import { invalidInput } from "../http.js";
import { loadAgenda } from "./admin-agenda-routes.js";
import { isoWeekday } from "./dates.js";
import { isClosedDay } from "./holidays.js";
import { loadSettings } from "./schedule.js";

type Reader = Pick<Database, "select">;

// Los seis días, de lunes a sábado; un día sin fila no abre.
async function loadHours(db: Reader): Promise<WeekdayHours[]> {
  const rows = await db.select().from(businessHours);
  return WEEKDAYS.map((weekday) => {
    const row = rows.find((r) => r.weekday === weekday);
    return {
      weekday,
      opensAt: row ? row.opensAt.slice(0, 5) : null,
      closesAt: row ? row.closesAt.slice(0, 5) : null,
    };
  });
}

async function loadScheduleSettings(db: Reader): Promise<ScheduleSettings> {
  const [hours, row] = await Promise.all([loadHours(db), loadSettings(db)]);
  const { bufferMinutes, bookingMinDays, bookingMaxMonths, cancelMinHours, rescheduleMinDays } =
    row;
  return {
    hours,
    rules: { bufferMinutes, bookingMinDays, bookingMaxMonths, cancelMinHours, rescheduleMinDays },
  };
}

// Panel de Caro: horario base de lunes a sábado, margen entre citas y reglas de reserva
// (RF15). Solo admin.
export function adminScheduleRouter(db: Database, now: () => Date): Router {
  const router = Router();
  router.use(requireAdmin(db));

  router.get("/", async (_req, res) => {
    res.set("Cache-Control", "no-store").json(await loadScheduleSettings(db));
  });

  // Guarda todo junto. No toma el turno de los días: una reserva que se confirma justo con
  // el horario anterior queda como cualquier cita existente, y la muestra el aviso.
  router.put("/", async (req, res) => {
    const parsed = scheduleSettingsRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { hours, rules } = parsed.data;

    const previous = await db.transaction(async (tx) => {
      const before = await loadHours(tx);
      await tx.delete(businessHours);
      const open = hours.flatMap(({ weekday, opensAt, closesAt }) =>
        opensAt && closesAt ? [{ weekday, opensAt, closesAt }] : [],
      );
      if (open.length > 0) await tx.insert(businessHours).values(open);
      // El margen nuevo solo vale para las citas nuevas: las guardadas conservan el suyo.
      await tx
        .update(settings)
        .set({ ...rules, updatedAt: new Date() })
        .where(eq(settings.id, 1));
      return before;
    });

    // Las citas agendadas desde ahora que entraban en el horario anterior y no en el nuevo.
    // Las que Caro agendó fuera de horario a propósito (RF11) no se repiten en cada guardado;
    // un festivo no abre con ningún horario.
    const current = now();
    const upcoming = await loadAgenda(
      db,
      and(eq(appointments.status, "scheduled"), gte(appointments.startAt, current)),
      current,
    );
    const dayOf = (list: WeekdayHours[], date: string) =>
      list.find((day) => day.weekday === isoWeekday(date));
    const outside = upcoming.filter(
      ({ date, time, durationMinutes }) =>
        !isClosedDay(date) &&
        fitsHours(dayOf(previous, date), time, durationMinutes) &&
        !fitsHours(dayOf(hours, date), time, durationMinutes),
    );

    const result: ScheduleSaved = { hours: await loadHours(db), rules, outside };
    res.set("Cache-Control", "no-store").json(result);
  });

  return router;
}
