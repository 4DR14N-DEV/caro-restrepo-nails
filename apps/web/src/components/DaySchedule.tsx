import {
  describeException,
  EARLIEST_OPENING,
  pastDayMessage,
  type AgendaException,
  type ExceptionRequest,
} from "@caro/shared";
import { useState, type SubmitEvent } from "react";
import { api, formErrorMessage, type ApiResult } from "../lib/api";

type Kind = ExceptionRequest["kind"];

const KINDS: { value: Kind; label: string }[] = [
  { value: "block_day", label: "Bloquear todo el día" },
  { value: "block", label: "Bloquear una franja" },
  { value: "break", label: "Descanso" },
  { value: "extra_open", label: "Abrir más temprano" },
];

// Horas en múltiplos de 15 minutos desde `first` hasta las 23:45.
function quarterHours(first: string): string[] {
  const hours: string[] = [];
  const [startHour = 0] = first.split(":").map(Number);
  for (let minutes = startHour * 60; minutes < 24 * 60; minutes += 15) {
    hours.push(
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    );
  }
  return hours;
}
const ALL_DAY = quarterHours("00:00");
const FROM_OPENING = quarterHours(EARLIEST_OPENING);

// El primer mensaje del error: el del formulario o el de algún campo.
function problemOf(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  return result.fields?.form ?? Object.values(result.fields ?? {})[0] ?? formErrorMessage(result);
}

const select = "h-11 rounded-xl border border-neutral-300 px-3 text-base";

interface Props {
  date: string;
  today: string;
  exceptions: AgendaException[];
  // Después de agregar o quitar algo: la agenda se vuelve a cargar.
  onChanged: () => void;
}

// El horario de un día (RF13, RF14): lo cargado y el formulario para agregar más.
export function DaySchedule({ date, today, exceptions, onChanged }: Props) {
  const [kind, setKind] = useState<Kind>("break");
  const [from, setFrom] = useState("13:00");
  const [to, setTo] = useState("14:00");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const past = date < today;

  function chooseKind(next: Kind) {
    setKind(next);
    // Abrir más temprano empieza a las 8:00; una franja o descanso, a la 1:00 p. m.
    setFrom(next === "extra_open" ? EARLIEST_OPENING : "13:00");
    setTo("14:00");
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const body: ExceptionRequest = {
      date,
      kind,
      ...(kind !== "block_day" ? { from } : {}),
      ...(kind === "block" || kind === "break" ? { to } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    setBusy(true);
    const result = await api.addException(body);
    setBusy(false);
    if (!result.ok) return setProblem(problemOf(result));
    setProblem(undefined);
    setReason("");
    onChanged();
  }

  async function remove(id: string) {
    const result = await api.removeException(id);
    if (!result.ok) return setProblem(problemOf(result));
    setProblem(undefined);
    onChanged();
  }

  return (
    <section
      aria-labelledby="horario-del-dia"
      className="flex flex-col gap-3 rounded-xl border border-neutral-300 p-4"
    >
      <h3 id="horario-del-dia" className="font-medium">
        Horario del día
      </h3>
      {exceptions.length === 0 ? (
        <p className="text-sm text-neutral-600">Sin bloqueos ni cambios de horario.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {exceptions.map((exception) => (
            <li key={exception.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {describeException(exception)}
                {exception.reason && ` · ${exception.reason}`}
              </span>
              {!past && (
                <button
                  type="button"
                  onClick={() => void remove(exception.id)}
                  className="h-9 rounded-lg border border-neutral-300 px-3 text-sm"
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p role="alert" className="text-sm text-red-700">
          {problem}
        </p>
      )}

      {past ? (
        <p className="text-sm text-neutral-600">{pastDayMessage}</p>
      ) : (
        <form
          onSubmit={(event) => void save(event)}
          className="flex flex-col gap-3 border-t border-neutral-200 pt-3"
        >
          <p className="text-sm font-medium">Agregar</p>
          <label className="flex flex-col gap-1 text-sm">
            Qué
            <select
              value={kind}
              onChange={(event) => chooseKind(event.target.value as Kind)}
              className={select}
            >
              {KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {kind !== "block_day" && (
            <label className="flex flex-col gap-1 text-sm">
              Desde
              <select
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className={select}
              >
                {(kind === "extra_open" ? FROM_OPENING : ALL_DAY).map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(kind === "block" || kind === "break") && (
            <label className="flex flex-col gap-1 text-sm">
              Hasta
              <select value={to} onChange={(event) => setTo(event.target.value)} className={select}>
                {ALL_DAY.map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Motivo (opcional)
            <input
              value={reason}
              maxLength={100}
              onChange={(event) => setReason(event.target.value)}
              className="h-11 rounded-xl border border-neutral-300 px-3 text-base"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="h-11 rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </form>
      )}
    </section>
  );
}
