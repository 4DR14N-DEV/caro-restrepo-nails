import {
  addDays,
  adminBookedMessage,
  adminCancelMessage,
  adminMovedMessage,
  bogotaDate,
  describeException,
  formatDay,
  formatMonth,
  formatTime,
  isCalendarDate,
  monthGrid,
  shiftMonth,
  weekDays,
  whatsappLink,
  type AgendaAppointment,
  type AgendaException,
  type MarkedStatus,
} from "@caro/shared";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, formErrorMessage } from "../lib/api";
import { AgendaCard } from "./AgendaCard";
import { AppointmentForm } from "./AppointmentForm";
import { DaySchedule } from "./DaySchedule";

type View = "day" | "week" | "month";

type Load =
  | { state: "loading" }
  | { state: "signed-out" }
  | { state: "forbidden" }
  | { state: "error"; message: string }
  | { state: "ready"; appointments: AgendaAppointment[]; exceptions: AgendaException[] };

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

const button = "h-11 rounded-xl border border-line px-3 text-sm font-medium text-ink";

interface Props {
  // Hoy en Bogotá. Se puede fijar para los tests.
  today?: string;
}

// Día que pide la dirección (?dia=2026-11-30): así abren la agenda los avisos push (RF18).
// Al compilar la página no hay dirección: se usa hoy.
function requestedDay(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const day = new URLSearchParams(window.location.search).get("dia");
  return day && isCalendarDate(day) ? day : undefined;
}

// Agenda de Caro (RF10): día, semana y mes, con marcar estado (RF12) y recordatorios (RF19).
export function AdminAgenda({ today = bogotaDate(new Date()) }: Props) {
  const [view, setView] = useState<View>("day");
  const [anchor, setAnchor] = useState(() => requestedDay() ?? today);
  const [withCancelled, setWithCancelled] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // Cambiarlo recarga la agenda sin volver a "Cargando…".
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<string>();
  const [cancelled, setCancelled] = useState<AgendaAppointment>();
  // La cita que se está creando ("new") o editando.
  const [formFor, setFormFor] = useState<"new" | AgendaAppointment>();
  // Lo último que Caro guardó desde el formulario, con el mensaje para avisarle a la clienta.
  const [saved, setSaved] = useState<{ appointment: AgendaAppointment; message: string }>();

  const { from, to } = rangeOf(view, anchor);

  useEffect(() => {
    let current = true;
    void api.agenda(from, to, withCancelled).then((result) => {
      if (!current) return;
      if (result.ok) {
        return setLoad({
          state: "ready",
          appointments: result.data.appointments,
          exceptions: result.data.exceptions ?? [],
        });
      }
      if (result.status === 401) return setLoad({ state: "signed-out" });
      if (result.status === 403) return setLoad({ state: "forbidden" });
      setLoad({ state: "error", message: formErrorMessage(result) });
    });
    return () => {
      current = false;
    };
  }, [from, to, withCancelled, reload]);

  // Ir a otra fecha o vista limpia los avisos. Solo muestra "Cargando…" si cambian las fechas:
  // si son las mismas (por ejemplo, "Hoy" estando en hoy), no se vuelve a pedir nada y la
  // agenda quedaría cargando para siempre.
  function go(nextView: View, nextAnchor: string) {
    const next = rangeOf(nextView, nextAnchor);
    if (next.from !== from || next.to !== to) setLoad({ state: "loading" });
    setNotice(undefined);
    setCancelled(undefined);
    setSaved(undefined);
    setFormFor(undefined);
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
                ...previous,
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
          className="flex h-12 items-center justify-center rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary"
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
      {/* En tablet, la vista y la navegación comparten una fila. */}
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-2 md:w-80">
          {VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              onClick={() => go(option.value, anchor)}
              className={`${button} flex-1 ${view === option.value ? "border-primary bg-primary text-on-primary" : ""}`}
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
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={withCancelled}
          onChange={(event) => {
            setLoad({ state: "loading" });
            setWithCancelled(event.target.checked);
          }}
          className="size-5 accent-accent"
        />
        Mostrar canceladas
      </label>

      {saved && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-line p-4">
          <p className="font-medium">Cita guardada.</p>
          {saved.appointment.client.phone && (
            <a
              href={whatsappLink(saved.appointment.client.phone, saved.message)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 items-center justify-center rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary"
            >
              Avisar a {saved.appointment.client.name} por WhatsApp
            </a>
          )}
        </div>
      )}
      {cancelled && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-line p-4">
          <p className="font-medium">Cita cancelada.</p>
          {cancelled.client.phone && (
            <a
              href={whatsappLink(
                cancelled.client.phone,
                adminCancelMessage({ clientName: cancelled.client.name, ...cancelled }),
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 items-center justify-center rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary"
            >
              Avisar a {cancelled.client.name} por WhatsApp
            </a>
          )}
        </div>
      )}
      {notice && (
        <p role="alert" className="text-danger">
          {notice}
        </p>
      )}

      {load.state === "loading" && <p className="text-muted">Cargando la agenda…</p>}
      {load.state === "error" && (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-danger">
            {load.message}
          </p>
          <button type="button" onClick={() => setReload((count) => count + 1)} className={button}>
            Reintentar
          </button>
        </div>
      )}
      {load.state === "ready" && view === "day" && (
        <DayView
          date={anchor}
          today={today}
          appointments={load.appointments}
          exceptions={load.exceptions}
          onMark={mark}
          onScheduleChanged={() => setReload((count) => count + 1)}
          form={
            formFor && (
              <AppointmentForm
                date={anchor}
                today={today}
                appointment={formFor === "new" ? undefined : formFor}
                onCancel={() => setFormFor(undefined)}
                onSaved={(appointment) => {
                  const before = formFor === "new" ? undefined : formFor;
                  // Mover la misma cita de la misma clienta avisa el cambio; crear,
                  // reasignar o cambiar solo los servicios avisa la cita agendada.
                  const moved =
                    before &&
                    before.client.id === appointment.client.id &&
                    (before.date !== appointment.date || before.time !== appointment.time);
                  const input = { clientName: appointment.client.name, ...appointment };
                  setSaved({
                    appointment,
                    message: moved ? adminMovedMessage(input) : adminBookedMessage(input),
                  });
                  setCancelled(undefined);
                  setNotice(undefined);
                  setFormFor(undefined);
                  setReload((count) => count + 1);
                }}
              />
            )
          }
          onNew={anchor >= today ? () => setFormFor("new") : undefined}
          onEdit={(appointment) => setFormFor(appointment)}
        />
      )}
      {load.state === "ready" && view === "week" && (
        <WeekView
          anchor={anchor}
          appointments={load.appointments}
          exceptions={load.exceptions}
          onOpen={(date) => go("day", date)}
        />
      )}
      {load.state === "ready" && view === "month" && (
        <MonthView
          anchor={anchor}
          appointments={load.appointments}
          exceptions={load.exceptions}
          onOpen={(date) => go("day", date)}
        />
      )}
    </div>
  );
}

function DayView({
  date,
  today,
  appointments,
  exceptions,
  onMark,
  onScheduleChanged,
  form,
  onNew,
  onEdit,
}: {
  date: string;
  today: string;
  appointments: AgendaAppointment[];
  exceptions: AgendaException[];
  onMark: (appointment: AgendaAppointment, status: MarkedStatus) => Promise<void>;
  onScheduleChanged: () => void;
  // El formulario de una cita nueva o en edición, si está abierto.
  form: ReactNode;
  // Sin función, el día ya pasó y no se ofrece crear citas.
  onNew: (() => void) | undefined;
  onEdit: (appointment: AgendaAppointment) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-2xl">{formatDay(date)}</h2>
      {form ??
        (onNew && (
          <button
            type="button"
            onClick={onNew}
            className="h-12 rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary"
          >
            Nueva cita
          </button>
        ))}
      {appointments.length === 0 ? (
        <p className="text-muted">No hay citas este día.</p>
      ) : (
        <ul className="flex flex-col gap-3 md:grid md:grid-cols-2 md:items-start">
          {appointments.map((appointment) => (
            <AgendaCard
              key={appointment.id}
              appointment={appointment}
              onMark={(status) => onMark(appointment, status)}
              onEdit={() => onEdit(appointment)}
            />
          ))}
        </ul>
      )}
      <DaySchedule
        date={date}
        today={today}
        exceptions={exceptions.filter((exception) => exception.date === date)}
        onChanged={onScheduleChanged}
      />
    </div>
  );
}

// En el celular no entran columnas: la semana es una lista de días. En tablet, una grilla.
function WeekView({
  anchor,
  appointments,
  exceptions,
  onOpen,
}: {
  anchor: string;
  appointments: AgendaAppointment[];
  exceptions: AgendaException[];
  onOpen: (date: string) => void;
}) {
  const days = weekDays(anchor);
  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-start lg:grid-cols-3">
      <h2 className="text-2xl md:col-span-full">Semana del {formatDay(days[0] ?? anchor)}</h2>
      {days.map((date) => {
        const ofDay = appointments.filter((appointment) => appointment.date === date);
        return (
          <section
            key={date}
            aria-labelledby={`dia-${date}`}
            className="flex flex-col gap-2 rounded-xl border border-line p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id={`dia-${date}`} className="font-medium">
                {formatDay(date)}
              </h3>
              <button type="button" onClick={() => onOpen(date)} className={button}>
                Ver día
              </button>
            </div>
            {exceptions
              .filter((exception) => exception.date === date)
              .map((exception) => (
                <p key={exception.id} className="text-sm text-muted">
                  {describeException(exception)}
                  {exception.reason && ` · ${exception.reason}`}
                </p>
              ))}
            {ofDay.length === 0 ? (
              <p className="text-sm text-muted">Sin citas</p>
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

// El mes: cuántas citas agendadas tiene cada día y cuáles están bloqueados enteros; tocar
// un día lo abre.
function MonthView({
  anchor,
  appointments,
  exceptions,
  onOpen,
}: {
  anchor: string;
  appointments: AgendaAppointment[];
  exceptions: AgendaException[];
  onOpen: (date: string) => void;
}) {
  const month = anchor.slice(0, 7);
  const scheduled = (date: string) =>
    appointments.filter(
      (appointment) => appointment.date === date && appointment.status === "scheduled",
    ).length;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-2xl">{formatMonth(anchor)}</h2>
      <div className="grid grid-cols-7 gap-1 text-center text-sm md:gap-2 md:text-base">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span key={index} aria-hidden="true" className="text-muted">
            {initial}
          </span>
        ))}
        {monthGrid(anchor)
          .weeks.flat()
          .map((date) => {
            const count = scheduled(date);
            const blocked = exceptions.some(
              (exception) => exception.date === date && exception.allDay,
            );
            return (
              <button
                key={date}
                type="button"
                aria-label={`${formatDay(date)}: ${count} ${count === 1 ? "cita" : "citas"}${blocked ? ", bloqueado" : ""}`}
                onClick={() => onOpen(date)}
                className={`flex h-14 flex-col items-center justify-center rounded-lg border md:h-24 ${
                  date.startsWith(month) ? "border-line" : "border-transparent text-muted/60"
                }`}
              >
                <span>{Number(date.slice(8))}</span>
                {count > 0 && <span className="text-xs font-medium md:text-sm">{count}</span>}
                {blocked && <span className="text-[10px] text-muted md:text-xs">Bloqueado</span>}
              </button>
            );
          })}
      </div>
    </div>
  );
}
