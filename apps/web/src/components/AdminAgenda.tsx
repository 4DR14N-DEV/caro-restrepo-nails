import {
  addDays,
  adminCancelMessage,
  bogotaDate,
  formatDay,
  formatMonth,
  formatTime,
  monthGrid,
  shiftMonth,
  weekDays,
  whatsappLink,
  type AgendaAppointment,
  type MarkedStatus,
} from "@caro/shared";
import { useCallback, useEffect, useState } from "react";
import { api, formErrorMessage } from "../lib/api";
import { AgendaCard } from "./AgendaCard";

type View = "day" | "week" | "month";

type Load =
  | { state: "loading" }
  | { state: "signed-out" }
  | { state: "forbidden" }
  | { state: "error"; message: string }
  | { state: "ready"; appointments: AgendaAppointment[] };

const LOGIN_URL = `/ingreso?next=${encodeURIComponent("/admin/agenda")}`;

const VIEWS: { value: View; label: string }[] = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
];

const STEP_LABELS: Record<View, [string, string]> = {
  day: ["Día anterior", "Día siguiente"],
  week: ["Semana anterior", "Semana siguiente"],
  month: ["Mes anterior", "Mes siguiente"],
};

// Las fechas que pide cada vista: el día, la semana de lunes a sábado o el mes en semanas completas.
function rangeOf(view: View, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const days = weekDays(anchor);
    return { from: days[0] ?? anchor, to: days.at(-1) ?? anchor };
  }
  const { first, last } = monthGrid(anchor);
  return { from: first, to: last };
}

function step(view: View, anchor: string, direction: 1 | -1): string {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  return shiftMonth(anchor, direction);
}

const button = "h-11 rounded-xl border border-neutral-300 px-3 text-sm font-medium";

interface Props {
  // Hoy en Bogotá. Se puede fijar para los tests.
  today?: string;
}

// Agenda de Caro (RF10): día, semana y mes, con marcar estado (RF12) y recordatorios (RF19).
export function AdminAgenda({ today = bogotaDate(new Date()) }: Props) {
  const [view, setView] = useState<View>("day");
  const [anchor, setAnchor] = useState(today);
  const [withCancelled, setWithCancelled] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // Cambiarlo recarga la agenda sin volver a "Cargando…".
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<string>();
  const [cancelled, setCancelled] = useState<AgendaAppointment>();

  const { from, to } = rangeOf(view, anchor);

  useEffect(() => {
    let current = true;
    void api.agenda(from, to, withCancelled).then((result) => {
      if (!current) return;
      if (result.ok) return setLoad({ state: "ready", appointments: result.data.appointments });
      if (result.status === 401) return setLoad({ state: "signed-out" });
      if (result.status === 403) return setLoad({ state: "forbidden" });
      setLoad({ state: "error", message: formErrorMessage(result) });
    });
    return () => {
      current = false;
    };
  }, [from, to, withCancelled, reload]);

  // Ir a otra fecha o vista muestra "Cargando…" y limpia los avisos.
  function go(nextView: View, nextAnchor: string) {
    setLoad({ state: "loading" });
    setNotice(undefined);
    setCancelled(undefined);
    setView(nextView);
    setAnchor(nextAnchor);
  }

  const mark = useCallback(
    async (appointment: AgendaAppointment, status: MarkedStatus) => {
      const result = await api.markAppointment(appointment.id, status);
      if (result.ok) {
        const updated = result.data.appointment;
        setNotice(undefined);
        setCancelled(updated.status === "cancelled" ? updated : undefined);
        setLoad((previous) =>
          previous.state === "ready"
            ? {
                state: "ready",
                appointments: previous.appointments
                  .map((item) => (item.id === updated.id ? updated : item))
                  // Sin "Mostrar canceladas", la cancelada deja la lista.
                  .filter((item) => withCancelled || item.status !== "cancelled"),
              }
            : previous,
        );
        return;
      }
      if (result.status === 401) return setLoad({ state: "signed-out" });
      setCancelled(undefined);
      setNotice(result.fields?.form ?? formErrorMessage(result));
      setReload((count) => count + 1);
    },
    [withCancelled],
  );

  if (load.state === "signed-out") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>Ingresa con la cuenta de Caro para ver la agenda.</p>
        <a
          href={LOGIN_URL}
          className="flex h-12 items-center justify-center rounded-xl bg-neutral-900 px-6 text-base font-medium text-white"
        >
          Ingresar
        </a>
      </div>
    );
  }
  if (load.state === "forbidden") return <p>Esta página es solo para Caro.</p>;

  const [previousLabel, nextLabel] = STEP_LABELS[view];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2">
        {VIEWS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={view === option.value}
            onClick={() => go(option.value, anchor)}
            className={`${button} flex-1 ${view === option.value ? "border-neutral-900 bg-neutral-900 text-white" : ""}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => go(view, step(view, anchor, -1))} className={button}>
          {previousLabel}
        </button>
        <button type="button" onClick={() => go(view, today)} className={button}>
          Hoy
        </button>
        <button type="button" onClick={() => go(view, step(view, anchor, 1))} className={button}>
          {nextLabel}
        </button>
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={withCancelled}
          onChange={(event) => {
            setLoad({ state: "loading" });
            setWithCancelled(event.target.checked);
          }}
          className="size-5 accent-neutral-900"
        />
        Mostrar canceladas
      </label>

      {cancelled && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-neutral-300 p-4">
          <p className="font-medium">Cita cancelada.</p>
          {cancelled.client.phone && (
            <a
              href={whatsappLink(
                cancelled.client.phone,
                adminCancelMessage({ clientName: cancelled.client.name, ...cancelled }),
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 items-center justify-center rounded-xl bg-neutral-900 px-6 text-base font-medium text-white"
            >
              Avisar a {cancelled.client.name} por WhatsApp
            </a>
          )}
        </div>
      )}
      {notice && (
        <p role="alert" className="text-red-700">
          {notice}
        </p>
      )}

      {load.state === "loading" && <p className="text-neutral-600">Cargando la agenda…</p>}
      {load.state === "error" && (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-red-700">
            {load.message}
          </p>
          <button type="button" onClick={() => setReload((count) => count + 1)} className={button}>
            Reintentar
          </button>
        </div>
      )}
      {load.state === "ready" && view === "day" && (
        <DayView date={anchor} appointments={load.appointments} onMark={mark} />
      )}
      {load.state === "ready" && view === "week" && (
        <WeekView
          anchor={anchor}
          appointments={load.appointments}
          onOpen={(date) => go("day", date)}
        />
      )}
      {load.state === "ready" && view === "month" && (
        <MonthView
          anchor={anchor}
          appointments={load.appointments}
          onOpen={(date) => go("day", date)}
        />
      )}
    </div>
  );
}

function DayView({
  date,
  appointments,
  onMark,
}: {
  date: string;
  appointments: AgendaAppointment[];
  onMark: (appointment: AgendaAppointment, status: MarkedStatus) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{formatDay(date)}</h2>
      {appointments.length === 0 ? (
        <p className="text-neutral-600">No hay citas este día.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {appointments.map((appointment) => (
            <AgendaCard
              key={appointment.id}
              appointment={appointment}
              onMark={(status) => onMark(appointment, status)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// En el celular no entran columnas: la semana es una lista de días.
function WeekView({
  anchor,
  appointments,
  onOpen,
}: {
  anchor: string;
  appointments: AgendaAppointment[];
  onOpen: (date: string) => void;
}) {
  const days = weekDays(anchor);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Semana del {formatDay(days[0] ?? anchor)}</h2>
      {days.map((date) => {
        const ofDay = appointments.filter((appointment) => appointment.date === date);
        return (
          <section
            key={date}
            aria-labelledby={`dia-${date}`}
            className="flex flex-col gap-2 rounded-xl border border-neutral-300 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id={`dia-${date}`} className="font-medium">
                {formatDay(date)}
              </h3>
              <button type="button" onClick={() => onOpen(date)} className={button}>
                Ver día
              </button>
            </div>
            {ofDay.length === 0 ? (
              <p className="text-sm text-neutral-600">Sin citas</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {ofDay.map((appointment) => (
                  <li key={appointment.id}>
                    {formatTime(appointment.time)} · {appointment.client.name} ·{" "}
                    {appointment.services.join(", ")}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

const WEEKDAY_INITIALS = ["L", "M", "M", "J", "V", "S", "D"];

// El mes: cuántas citas agendadas tiene cada día; tocar un día lo abre.
function MonthView({
  anchor,
  appointments,
  onOpen,
}: {
  anchor: string;
  appointments: AgendaAppointment[];
  onOpen: (date: string) => void;
}) {
  const month = anchor.slice(0, 7);
  const scheduled = (date: string) =>
    appointments.filter(
      (appointment) => appointment.date === date && appointment.status === "scheduled",
    ).length;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{formatMonth(anchor)}</h2>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span key={index} aria-hidden="true" className="text-neutral-600">
            {initial}
          </span>
        ))}
        {monthGrid(anchor)
          .weeks.flat()
          .map((date) => {
            const count = scheduled(date);
            return (
              <button
                key={date}
                type="button"
                aria-label={`${formatDay(date)}: ${count} ${count === 1 ? "cita" : "citas"}`}
                onClick={() => onOpen(date)}
                className={`flex h-14 flex-col items-center justify-center rounded-lg border ${
                  date.startsWith(month)
                    ? "border-neutral-300"
                    : "border-transparent text-neutral-400"
                }`}
              >
                <span>{Number(date.slice(8))}</span>
                {count > 0 && <span className="text-xs font-medium">{count}</span>}
              </button>
            );
          })}
      </div>
    </div>
  );
}
