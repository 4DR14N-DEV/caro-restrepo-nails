import { bookingTimesQuerySchema, summarize } from "@caro/shared";
import { Router } from "express";
import type { Database } from "../db/client.js";
import { invalidInput } from "../http.js";
import { bookingWindow, openIntervals } from "./availability.js";
import { bogotaDate } from "./dates.js";
import { serviceUnavailable } from "./responses.js";
import { loadActiveServices, loadDays, loadSettings, offeredTimes } from "./schedule.js";

// Disponibilidad pública (RF05): los días que abren dentro de la ventana de reserva y las
// horas libres de un día para los servicios elegidos. No muestra datos de nadie.
export function bookingRouter(db: Database, now: () => Date): Router {
  const router = Router();

  router.get("/days", async (_req, res) => {
    const rules = await loadSettings(db);
    const { first, last } = bookingWindow(bogotaDate(now()), rules);
    const days = await loadDays(db, first, last);
    res.json({ days: days.filter((day) => openIntervals(day).length > 0).map((day) => day.date) });
  });

  router.get("/times", async (req, res) => {
    const parsed = bookingTimesQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { date, services: ids } = parsed.data;

    const chosen = await loadActiveServices(db, ids);
    if (!chosen) return serviceUnavailable(res);

    const { times } = await offeredTimes(db, now, date, summarize(chosen).durationMinutes);
    res.json({ times });
  });

  return router;
}
