import { bookingTimesQuerySchema, serviceUnavailableMessage, summarize } from "@caro/shared";
import { Router, type Response } from "express";
import type { Database } from "../db/client.js";
import { invalidInput } from "../http.js";
import { availableTimes, bookingWindow, openIntervals } from "./availability.js";
import { bogotaDate } from "./dates.js";
import { loadActiveServices, loadDays, loadSettings } from "./schedule.js";

export function serviceUnavailable(res: Response): void {
  res
    .status(409)
    .json({ error: "service_unavailable", fields: { services: serviceUnavailableMessage } });
}

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

    const rules = await loadSettings(db);
    const { first, last } = bookingWindow(bogotaDate(now()), rules);
    if (date < first || date > last) {
      res.json({ times: [] });
      return;
    }

    const [day] = await loadDays(db, date, date);
    const { durationMinutes } = summarize(chosen);
    res.json({ times: day ? availableTimes(day, durationMinutes, rules) : [] });
  });

  return router;
}
