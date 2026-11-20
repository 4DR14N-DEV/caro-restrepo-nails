import {
  bookingRequestSchema,
  slotTakenMessage,
  summarize,
  type BookingResult,
} from "@caro/shared";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { Router, type Response } from "express";
import { currentUser } from "../auth/require-user.js";
import type { Database } from "../db/client.js";
import { EXCLUSION_VIOLATION, hasPgCode } from "../db/errors.js";
import { appointments, appointmentServices, users } from "../db/schema.js";
import { invalidInput } from "../http.js";
import { availableTimes, bookingWindow } from "./availability.js";
import { bogotaDate, bogotaInstant } from "./dates.js";
import { serviceUnavailable } from "./routes.js";
import { loadActiveServices, loadDays, loadSettings } from "./schedule.js";

const MINUTE = 60_000;

function slotTaken(res: Response): void {
  res.status(409).json({ error: "slot_taken", fields: { time: slotTakenMessage } });
}

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

// Reservar (RF06): la cita queda confirmada al instante si la hora está libre.
export function appointmentsRouter(db: Database, now: () => Date): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const user = await currentUser(db, req, res);
    if (!user) return;

    const parsed = bookingRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { serviceIds, date, time } = parsed.data;

    const chosen = await loadActiveServices(db, serviceIds);
    if (!chosen) return serviceUnavailable(res);
    const { durationMinutes, priceCop } = summarize(chosen);

    // La disponibilidad se vuelve a calcular aquí: solo vale una hora que el motor ofrece
    // ahora mismo, no la que la página mostró hace un rato.
    const rules = await loadSettings(db);
    const { first, last } = bookingWindow(bogotaDate(now()), rules);
    const [day] = date >= first && date <= last ? await loadDays(db, date, date) : [];
    if (!day || !availableTimes(day, durationMinutes, rules).includes(time)) {
      return slotTaken(res);
    }

    // Se busca antes de guardar: después del commit, un fallo de esta lectura daría un
    // error a una clienta cuya cita sí quedó guardada.
    const caroWhatsapp = await caroPhone(db);

    const startAt = bogotaInstant(date, time);
    const endAt = new Date(startAt.getTime() + durationMinutes * MINUTE);
    const occupiedUntil = new Date(endAt.getTime() + rules.bufferMinutes * MINUTE);

    let id: string;
    try {
      id = await db.transaction(async (tx) => {
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
      // Otra reserva tomó la hora entre el cálculo y el guardado: la restricción de
      // exclusión de la base lo impide (RF21).
      if (hasPgCode(error, EXCLUSION_VIOLATION)) return slotTaken(res);
      throw error;
    }

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
