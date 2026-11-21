import type { AgendaException } from "@caro/shared";
import { addDays, bogotaDate, bogotaInstant, bogotaTime } from "./dates.js";

type ExceptionRow = {
  id: string;
  kind: AgendaException["kind"];
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
};

// Una excepción del horario tal como la ve Caro. El fin a la medianoche siguiente se
// muestra como "24:00", y si cubre el día entero es un bloqueo de todo el día.
export function toAgendaException(row: ExceptionRow): AgendaException {
  const date = bogotaDate(row.startsAt);
  const from = bogotaTime(row.startsAt);
  const endsAtMidnight =
    row.endsAt.getTime() === bogotaInstant(addDays(date, 1), "00:00").getTime();
  const to = endsAtMidnight ? "24:00" : bogotaTime(row.endsAt);
  return {
    id: row.id,
    date,
    kind: row.kind,
    from,
    to,
    allDay: from === "00:00" && to === "24:00",
    reason: row.reason,
  };
}
