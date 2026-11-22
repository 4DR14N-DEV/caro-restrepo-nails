import {
  EARLIEST_OPENING,
  formatTime,
  formatWhen,
  LATEST_CLOSING,
  outsideHoursMessage,
  scheduleSettingsRequestSchema,
  type AgendaAppointment,
  type BookingRules,
  type ScheduleSettings,
  type WeekdayHours,
} from "@caro/shared";
import { useCallback, useEffect, useState, type SubmitEvent } from "react";
import { api, formErrorMessage, type ApiResult } from "../lib/api";

type Load =
  | { state: "loading" }
  | { state: "signed-out" }
  | { state: "forbidden" }
  | { state: "error"; message: string }
  | { state: "ready" };

const LOGIN_URL = `/ingreso?next=${encodeURIComponent("/admin/horario")}`;

const DAY_NAMES: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
};

// Al abrir un día cerrado se propone el horario de siempre.
const DEFAULT_OPENING = "09:00";
const DEFAULT_CLOSING = "19:00";

// Horas en múltiplos de 15 minutos, de la apertura más temprana al cierre más tarde.
function quarterHours(first: string, last: string): string[] {
  const toMinutes = (time: string) => {
    const [hours = 0, minutes = 0] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const hours: string[] = [];
  for (let minutes = toMinutes(first); minutes <= toMinutes(last); minutes += 15) {
    hours.push(
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    );
  }
  return hours;
}
const HOURS = quarterHours(EARLIEST_OPENING, LATEST_CLOSING);

const RULE_FIELDS: { key: keyof BookingRules; label: string; step: number }[] = [
  { key: "bufferMinutes", label: "Margen entre citas (minutos)", step: 5 },
  { key: "bookingMinDays", label: "Reservar con al menos (días de anticipación)", step: 1 },
  { key: "bookingMaxMonths", label: "Reservar hasta (meses de anticipación)", step: 1 },
  { key: "cancelMinHours", label: "Cancelar hasta (horas antes de la cita)", step: 1 },
  { key: "rescheduleMinDays", label: "Reprogramar hasta (días antes de la cita)", step: 1 },
];

type RuleTexts = Record<keyof BookingRules, string>;

const toTexts = (rules: BookingRules): RuleTexts =>
  Object.fromEntries(RULE_FIELDS.map(({ key }) => [key, String(rules[key])])) as RuleTexts;

// Un campo vacío no es 0: la validación lo rechaza con el mensaje de ese campo.
const toRules = (texts: RuleTexts): BookingRules =>
  Object.fromEntries(
    RULE_FIELDS.map(({ key }) => [key, texts[key].trim() === "" ? Number.NaN : Number(texts[key])]),
  ) as unknown as BookingRules;

const select = "h-11 rounded-xl border border-line px-3 text-base text-ink bg-surface";
// Errores junto al campo: se anuncian a los lectores de pantalla al aparecer.
const fieldError = "text-sm text-danger";

// Panel de Caro: horario base de lunes a sábado, margen entre citas y reglas de reserva (RF15).
export function AdminSchedule() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [hours, setHours] = useState<WeekdayHours[]>([]);
  const [rules, setRules] = useState<RuleTexts>();
  // Mensajes por campo: "hours.0.closesAt", "rules.bufferMinutes".
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string>();
  const [saved, setSaved] = useState<AgendaAppointment[]>();
  const [busy, setBusy] = useState(false);

  // Sin sesión (venció) o sin permiso: el panel cambia de estado en vez de pedir que reintente.
  const lostAccess = useCallback((result: ApiResult<unknown>): boolean => {
    if (result.ok || (result.status !== 401 && result.status !== 403)) return false;
    setLoad({ state: result.status === 401 ? "signed-out" : "forbidden" });
    return true;
  }, []);

  const show = useCallback((settings: ScheduleSettings) => {
    setHours(settings.hours);
    setRules(toTexts(settings.rules));
  }, []);

  const fetchSchedule = useCallback(async () => {
    setLoad({ state: "loading" });
    const result = await api.schedule();
    if (result.ok) {
      show(result.data);
      setLoad({ state: "ready" });
    } else if (!lostAccess(result)) {
      setLoad({
        state: "error",
        message:
          result.error === "network"
            ? "No pudimos cargar el horario. Revisa tu internet e inténtalo de nuevo."
            : "No pudimos cargar el horario. Inténtalo de nuevo en un momento.",
      });
    }
  }, [lostAccess, show]);

  useEffect(() => {
    void fetchSchedule();
  }, [fetchSchedule]);

  function changeDay(weekday: number, change: Partial<WeekdayHours>) {
    setHours((now) => now.map((day) => (day.weekday === weekday ? { ...day, ...change } : day)));
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rules) return;
    setSaved(undefined);
    setProblem(undefined);
    const parsed = scheduleSettingsRequestSchema.safeParse({ hours, rules: toRules(rules) });
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) found[issue.path.join(".")] ??= issue.message;
      setErrors(found);
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await api.saveSchedule(parsed.data);
    setBusy(false);
    if (result.ok) {
      show(result.data);
      setSaved(result.data.outside);
    } else if (!lostAccess(result)) {
      setProblem(
        result.status === 400
          ? (Object.values(result.fields ?? {})[0] ?? formErrorMessage(result))
          : formErrorMessage(result),
      );
    }
  }

  if (load.state === "loading") return <p className="text-muted">Cargando el horario…</p>;

  if (load.state === "signed-out") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>Ingresa con la cuenta de Caro para cambiar el horario.</p>
        <a
          href={LOGIN_URL}
          className="flex h-12 items-center rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary"
        >
          Ingresar
        </a>
      </div>
    );
  }

  if (load.state === "forbidden") return <p>Esta página es solo para Caro.</p>;

  if (load.state === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-danger">
          {load.message}
        </p>
        <button
          type="button"
          onClick={() => void fetchSchedule()}
          className="h-12 rounded-xl border border-line px-4 text-base font-medium text-ink"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-6" noValidate>
      <section aria-labelledby="horario-base" className="flex flex-col gap-3">
        <h2 id="horario-base" className="text-2xl">
          Horario de la semana
        </h2>
        <p className="text-sm text-muted">Domingos y festivos no se atiende.</p>
        {hours.map((day, index) => {
          const name = DAY_NAMES[day.weekday] ?? "";
          const open = day.opensAt !== null && day.closesAt !== null;
          const errorOf = (field: string) => errors[`hours.${index}.${field}`];
          return (
            <fieldset
              key={day.weekday}
              className="flex flex-col gap-2 rounded-xl border border-line p-4"
            >
              <legend className="px-1 font-medium">{name}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={open}
                  onChange={(event) =>
                    changeDay(
                      day.weekday,
                      event.target.checked
                        ? { opensAt: DEFAULT_OPENING, closesAt: DEFAULT_CLOSING }
                        : { opensAt: null, closesAt: null },
                    )
                  }
                  className="h-5 w-5"
                />
                Abre
              </label>
              {open ? (
                <div className="flex gap-3">
                  <label className="flex flex-1 flex-col gap-1 text-sm">
                    Desde
                    <select
                      value={day.opensAt ?? ""}
                      onChange={(event) => changeDay(day.weekday, { opensAt: event.target.value })}
                      className={select}
                    >
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {formatTime(hour)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-sm">
                    Hasta
                    <select
                      value={day.closesAt ?? ""}
                      onChange={(event) => changeDay(day.weekday, { closesAt: event.target.value })}
                      className={select}
                    >
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {formatTime(hour)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
                <p className="text-sm text-muted">Cerrado</p>
              )}
              {(errorOf("opensAt") ?? errorOf("closesAt")) && (
                <p role="alert" className={fieldError}>
                  {errorOf("opensAt") ?? errorOf("closesAt")}
                </p>
              )}
            </fieldset>
          );
        })}
        {errors.hours && (
          <p role="alert" className={fieldError}>
            {errors.hours}
          </p>
        )}
      </section>

      <section aria-labelledby="reglas" className="flex flex-col gap-3">
        <h2 id="reglas" className="text-2xl">
          Reglas
        </h2>
        <p className="text-sm text-muted">
          El margen nuevo vale para las citas que se reserven desde ahora.
        </p>
        {rules &&
          RULE_FIELDS.map(({ key, label, step }) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              {label}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={step}
                value={rules[key]}
                onChange={(event) => setRules({ ...rules, [key]: event.target.value })}
                className="h-11 rounded-xl border border-line px-3 text-base text-ink bg-surface"
              />
              {errors[`rules.${key}`] && (
                <span role="alert" className={fieldError}>
                  {errors[`rules.${key}`]}
                </span>
              )}
            </label>
          ))}
      </section>

      {problem && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {problem}
        </p>
      )}
      {saved && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl bg-success-soft px-4 py-3 text-sm"
        >
          <p className="font-medium text-success">Horario guardado.</p>
          {saved.length > 0 && (
            <>
              <p className="text-warning">{outsideHoursMessage(saved.length)}</p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {saved.map((appointment) => (
                  <li key={appointment.id}>
                    {`${formatWhen(appointment.date, appointment.time)} · ${appointment.client.name} · ${appointment.services.join(", ")}`}
                  </li>
                ))}
              </ul>
              <a href="/admin/agenda" className="underline">
                Ver agenda
              </a>
            </>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="h-12 rounded-xl bg-primary hover:bg-primary-hover text-base font-medium text-on-primary disabled:opacity-60"
      >
        {busy ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
