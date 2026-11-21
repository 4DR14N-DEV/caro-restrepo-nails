import {
  adminAppointmentRequestSchema,
  clientUnavailableMessage,
  isUuid,
  notEditableMessage,
  pastTimeMessage,
  slotClashMessage,
  summarize,
  type AgendaChange,
  type ClientSummary,
} from "@caro/shared";
import { and, asc, eq, gt, ilike, isNull, like, lt, ne, or } from "drizzle-orm";
import { Router, type Response } from "express";
import { requireAdmin } from "../auth/require-admin.js";
import type { Database } from "../db/client.js";
import { writeConflict } from "../db/errors.js";
import { appointments, appointmentServices, users } from "../db/schema.js";
import { invalidInput } from "../http.js";
import { loadAgenda } from "./admin-agenda-routes.js";
import { bogotaDate, bogotaInstant, MINUTE } from "./dates.js";
import { limitLockWait, lockDay } from "./locks.js";
import { serviceUnavailable } from "./responses.js";
import { loadActiveServices, loadSettings } from "./schedule.js";

const SEARCH_LIMIT = 10;

function conflict(res: Response, error: string, field: string, message: string): void {
  res.status(409).json({ error, fields: { [field]: message } });
}

// Errores al guardar con el turno tomado. Devuelve true si ya respondió. La restricción de
// exclusión es la red de seguridad contra superponer citas (RF21).
function answeredWriteError(error: unknown, res: Response): boolean {
  const kind = writeConflict(error);
  if (kind === "busy") res.status(503).json({ error: "busy" });
  if (kind === "clash") conflict(res, "slot_taken", "time", slotClashMessage);
  return kind !== undefined;
}

// Una clienta con cuenta activa (no admin, no borrada).
async function activeClient(db: Pick<Database, "select">, id: string) {
  const [client] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "client"), isNull(users.anonymizedAt)));
  return client;
}

// ¿Hay una cita agendada (con su margen) que se pisa con [start, occupiedUntil)?
async function clashes(
  tx: Pick<Database, "select">,
  start: Date,
  occupiedUntil: Date,
  exceptId?: string,
): Promise<boolean> {
  const [other] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.status, "scheduled"),
        lt(appointments.startAt, occupiedUntil),
        gt(appointments.occupiedUntil, start),
        exceptId ? ne(appointments.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(other);
}

// Búsqueda de clientas para agendar a su nombre: por nombre o por celular.
export function adminClientsRouter(db: Database): Router {
  const router = Router();
  router.use(requireAdmin(db));

  router.get("/", async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.json({ clients: [] });
      return;
    }
    // Los comodines de LIKE que escriba Caro se buscan como texto.
    const text = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const digits = q.replace(/\D/g, "");
    const rows = await db
      .select({ id: users.id, name: users.name, phone: users.phone })
      .from(users)
      .where(
        and(
          eq(users.role, "client"),
          isNull(users.anonymizedAt),
          or(
            ilike(users.name, text),
            digits.length >= 3 ? like(users.phone, `%${digits}%`) : undefined,
          ),
        ),
      )
      .orderBy(asc(users.name), asc(users.id))
      .limit(SEARCH_LIMIT);
    const clients: ClientSummary[] = rows.flatMap((row) =>
      row.phone ? [{ id: row.id, name: row.name, phone: row.phone }] : [],
    );
    res.set("Cache-Control", "no-store").json({ clients });
  });

  return router;
}

// Citas que Caro agenda a nombre de una clienta (RF11), sin las restricciones de las
// clientas: cualquier día y hora desde ahora, en pasos de 15 minutos. Lo único que no se
// puede es pisar otra cita agendada. Solo admin.
export function adminBookingRouter(db: Database, now: () => Date): Router {
  const router = Router();
  router.use(requireAdmin(db));

  async function respond(res: Response, id: string, status: number) {
    const [appointment] = await loadAgenda(db, eq(appointments.id, id), now());
    if (!appointment) throw new Error("No se leyó la cita guardada.");
    const result: AgendaChange = { appointment };
    res.status(status).set("Cache-Control", "no-store").json(result);
  }

  router.post("/", async (req, res) => {
    const parsed = adminAppointmentRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { clientId, serviceIds, date, time } = parsed.data;

    if (!(await activeClient(db, clientId))) {
      return conflict(res, "client_unavailable", "clientId", clientUnavailableMessage);
    }
    const chosen = await loadActiveServices(db, serviceIds);
    if (!chosen) return serviceUnavailable(res);
    const startAt = bogotaInstant(date, time);
    if (startAt <= now()) return conflict(res, "past_time", "time", pastTimeMessage);

    const { durationMinutes, priceCop } = summarize(chosen);
    const rules = await loadSettings(db);
    const endAt = new Date(startAt.getTime() + durationMinutes * MINUTE);
    const occupiedUntil = new Date(endAt.getTime() + rules.bufferMinutes * MINUTE);

    let id: string | undefined;
    try {
      id = await db.transaction(async (tx) => {
        // El turno del día, el mismo de las reservas.
        await limitLockWait(tx);
        await lockDay(tx, date);
        if (await clashes(tx, startAt, occupiedUntil)) return undefined;
        const [row] = await tx
          .insert(appointments)
          .values({
            clientId,
            startAt,
            endAt,
            occupiedUntil,
            totalPriceCop: priceCop,
            createdBy: "admin",
          })
          .returning({ id: appointments.id });
        if (!row) throw new Error("No se guardó la cita.");
        await tx.insert(appointmentServices).values(
          chosen.map((service) => ({
            appointmentId: row.id,
            serviceId: service.id,
            serviceName: service.name,
            priceCop: service.priceCop,
            durationMinutes: service.durationMinutes,
          })),
        );
        return row.id;
      });
    } catch (error) {
      if (answeredWriteError(error, res)) return;
      throw error;
    }
    if (!id) return conflict(res, "slot_taken", "time", slotClashMessage);
    await respond(res, id, 201);
  });

  // Editar: día, hora, servicios y clienta. Si los servicios son los mismos, se conservan
  // sus copias y precios; si cambian, se vuelven a copiar con los precios de hoy.
  router.patch("/:id", async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const parsed = adminAppointmentRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { clientId, serviceIds, date, time } = parsed.data;

    const [existing] = await db
      .select({ startAt: appointments.startAt })
      .from(appointments)
      .where(eq(appointments.id, id));
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!(await activeClient(db, clientId))) {
      return conflict(res, "client_unavailable", "clientId", clientUnavailableMessage);
    }

    const copies = await db
      .select()
      .from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, id));
    const sameServices =
      copies.length === serviceIds.length &&
      copies.every((copy) => serviceIds.includes(copy.serviceId));
    const chosen = sameServices ? undefined : await loadActiveServices(db, serviceIds);
    if (!sameServices && !chosen) return serviceUnavailable(res);
    const { durationMinutes, priceCop } = summarize(chosen ?? copies);

    const startAt = bogotaInstant(date, time);
    if (startAt <= now()) return conflict(res, "past_time", "time", pastTimeMessage);
    const rules = await loadSettings(db);
    const endAt = new Date(startAt.getTime() + durationMinutes * MINUTE);
    const occupiedUntil = new Date(endAt.getTime() + rules.bufferMinutes * MINUTE);

    let outcome: "saved" | "not_editable" | "clash";
    try {
      outcome = await db.transaction(async (tx) => {
        // Turnos del día viejo y del nuevo, siempre en orden de fecha (como reprogramar).
        await limitLockWait(tx);
        for (const day of [...new Set([bogotaDate(existing.startAt), date])].sort()) {
          await lockDay(tx, day);
        }
        const [fresh] = await tx
          .select({ status: appointments.status })
          .from(appointments)
          .where(eq(appointments.id, id))
          .for("update");
        if (fresh?.status !== "scheduled") return "not_editable";
        if (await clashes(tx, startAt, occupiedUntil, id)) return "clash";

        await tx
          .update(appointments)
          .set({
            clientId,
            startAt,
            endAt,
            occupiedUntil,
            totalPriceCop: priceCop,
            updatedAt: now(),
          })
          .where(eq(appointments.id, id));
        if (chosen) {
          await tx.delete(appointmentServices).where(eq(appointmentServices.appointmentId, id));
          await tx.insert(appointmentServices).values(
            chosen.map((service) => ({
              appointmentId: id,
              serviceId: service.id,
              serviceName: service.name,
              priceCop: service.priceCop,
              durationMinutes: service.durationMinutes,
            })),
          );
        }
        return "saved";
      });
    } catch (error) {
      if (answeredWriteError(error, res)) return;
      throw error;
    }
    if (outcome === "not_editable") {
      return conflict(res, "not_editable", "form", notEditableMessage);
    }
    if (outcome === "clash") return conflict(res, "slot_taken", "time", slotClashMessage);
    await respond(res, id, 200);
  });

  return router;
}
