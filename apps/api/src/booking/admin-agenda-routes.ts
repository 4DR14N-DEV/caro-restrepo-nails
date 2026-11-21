import { agendaQuerySchema, type Agenda, type AgendaAppointment } from "@caro/shared";
import { and, asc, eq, gte, lt, ne } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin } from "../auth/require-admin.js";
import type { Database } from "../db/client.js";
import { appointments, users } from "../db/schema.js";
import { invalidInput } from "../http.js";
import { addDays, bogotaDate, bogotaInstant, bogotaTime, MINUTE } from "./dates.js";
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

// Panel de Caro: la agenda (RF10). Solo admin.
export function adminAgendaRouter(db: Database, now: () => Date): Router {
  const router = Router();
  router.use(requireAdmin(db));

  router.get("/", async (req, res) => {
    const parsed = agendaQuerySchema.safeParse(req.query);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const { from, to } = parsed.data;
    const withCancelled = parsed.data.cancelled === "1";

    const rows = await db
      .select(agendaColumns)
      .from(appointments)
      .innerJoin(users, eq(users.id, appointments.clientId))
      .where(
        and(
          gte(appointments.startAt, bogotaInstant(from, "00:00")),
          lt(appointments.startAt, bogotaInstant(addDays(to, 1), "00:00")),
          withCancelled ? undefined : ne(appointments.status, "cancelled"),
        ),
      )
      .orderBy(asc(appointments.startAt), asc(appointments.id));

    const names = await serviceNamesByAppointment(
      db,
      rows.map((row) => row.id),
    );
    const current = now();
    const result: Agenda = {
      appointments: rows.map((row) => toAgenda(row, names.get(row.id) ?? [], current)),
    };
    // Datos de las clientas: que no queden guardados en ningún lado.
    res.set("Cache-Control", "no-store").json(result);
  });

  return router;
}
