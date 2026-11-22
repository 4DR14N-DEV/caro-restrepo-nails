import {
  formatDayShort,
  formatTime,
  rescheduleTooLateMessage,
  slotTakenMessage,
  type MyAppointment,
} from "@caro/shared";
import { useEffect, useState } from "react";
import { api, formErrorMessage } from "../lib/api";
import type { Change } from "./ChangeDone";
import { ChoiceGrid } from "./ChoiceGrid";

const LOGIN_URL = `/ingreso?next=${encodeURIComponent("/mis-citas")}`;

interface Props {
  appointment: MyAppointment;
  onDone: (change: Change) => void;
  // Un problema que cambia la lista (por ejemplo, ya no se puede reprogramar).
  onProblem: (message: string) => void;
  onBack: () => void;
}

type List =
  | { state: "idle" | "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; items: string[] };

// Reprogramar (RF09): los mismos días que al reservar y las horas en las que entra esta cita,
// sin que su propio horario cuente como ocupado. Los servicios no cambian.
export function RescheduleFlow({ appointment, onDone, onProblem, onBack }: Props) {
  const [days, setDays] = useState<List>({ state: "loading" });
  const [date, setDate] = useState<string>();
  const [times, setTimes] = useState<List>({ state: "idle" });
  // Cambiarlo vuelve a pedir las horas (por ejemplo, después de perder una hora).
  const [timesRequest, setTimesRequest] = useState(0);
  const [time, setTime] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void api
      .bookingDays()
      .then((result) =>
        setDays(
          result.ok
            ? { state: "ready", items: result.data.days }
            : { state: "error", message: formErrorMessage(result) },
        ),
      );
  }, []);

  useEffect(() => {
    if (!date) return;
    // Si la clienta cambia de día antes de que llegue la respuesta, se descarta.
    let current = true;
    setTimes({ state: "loading" });
    void api.rescheduleTimes(appointment.id, date).then((result) => {
      if (!current) return;
      if (!result.ok && result.error === "reschedule_too_late") {
        return onProblem(result.fields?.form ?? rescheduleTooLateMessage);
      }
      setTimes(
        result.ok
          ? { state: "ready", items: result.data.times }
          : { state: "error", message: formErrorMessage(result) },
      );
    });
    return () => {
      current = false;
    };
  }, [appointment.id, date, timesRequest, onProblem]);

  async function confirm() {
    if (!date || !time) return;
    setSubmitting(true);
    const result = await api.rescheduleAppointment(appointment.id, { date, time });
    setSubmitting(false);

    if (result.ok) {
      return onDone({
        kind: "moved",
        before: appointment,
        after: result.data.appointment,
        caroWhatsapp: result.data.caroWhatsapp,
      });
    }
    if (result.status === 401) return window.location.replace(LOGIN_URL);
    if (result.error === "reschedule_too_late") {
      return onProblem(result.fields?.form ?? rescheduleTooLateMessage);
    }
    setTime(undefined);
    if (result.error === "slot_taken") {
      setNotice(result.fields?.time ?? slotTakenMessage);
      setTimesRequest((count) => count + 1);
    } else {
      setNotice(formErrorMessage(result));
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line-soft pt-3">
      <p className="font-medium">Elige el día nuevo</p>
      {days.state === "loading" && <p className="text-muted">Cargando días…</p>}
      {days.state === "error" && (
        <p role="alert" className="text-danger">
          {days.message}
        </p>
      )}
      {days.state === "ready" && (
        <ChoiceGrid
          label="Días"
          options={days.items.map((day) => ({ value: day, label: formatDayShort(day) }))}
          selected={date}
          onSelect={(value) => {
            setDate(value);
            setTime(undefined);
            setNotice(undefined);
          }}
        />
      )}

      {date && (
        <>
          <p className="font-medium">Elige la hora nueva</p>
          {notice && (
            <p role="alert" className="text-danger">
              {notice}
            </p>
          )}
          {times.state === "loading" && <p className="text-muted">Buscando horas…</p>}
          {times.state === "error" && (
            <p role="alert" className="text-danger">
              {times.message}
            </p>
          )}
          {times.state === "ready" &&
            (times.items.length === 0 ? (
              <p className="text-muted">No quedan horas libres este día. Prueba con otro.</p>
            ) : (
              <ChoiceGrid
                label="Horas"
                options={times.items.map((value) => ({ value, label: formatTime(value) }))}
                selected={time}
                onSelect={(value) => {
                  setTime(value);
                  setNotice(undefined);
                }}
              />
            ))}
        </>
      )}

      {date && time && (
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={submitting}
          className="h-12 rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary disabled:opacity-60"
        >
          {submitting ? "Guardando…" : "Confirmar cambio"}
        </button>
      )}
      <button
        type="button"
        onClick={onBack}
        className="h-12 rounded-xl border border-line px-6 text-base font-medium text-ink"
      >
        Volver
      </button>
    </div>
  );
}
