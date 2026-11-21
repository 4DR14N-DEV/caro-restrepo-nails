import { cancelTooLateMessage, type MyAppointment } from "@caro/shared";
import { useState } from "react";
import { api, formErrorMessage } from "../lib/api";
import type { Change } from "./ChangeDone";
import { RescheduleFlow } from "./RescheduleFlow";

const LOGIN_URL = `/ingreso?next=${encodeURIComponent("/mis-citas")}`;

interface Props {
  appointment: MyAppointment;
  onDone: (change: Change) => void;
  onProblem: (message: string) => void;
}

const button = "h-12 flex-1 rounded-xl border border-neutral-300 px-4 text-base font-medium";

// Cancelar (RF08) y reprogramar (RF09) una cita próxima, solo cuando las reglas lo permiten.
export function AppointmentActions({ appointment, onDone, onProblem }: Props) {
  const [mode, setMode] = useState<"idle" | "confirm" | "reschedule">("idle");
  const [submitting, setSubmitting] = useState(false);

  async function cancel() {
    setSubmitting(true);
    const result = await api.cancelAppointment(appointment.id);
    setSubmitting(false);
    setMode("idle");

    if (result.ok) {
      return onDone({
        kind: "cancelled",
        before: appointment,
        caroWhatsapp: result.data.caroWhatsapp,
      });
    }
    if (result.status === 401) return window.location.replace(LOGIN_URL);
    onProblem(
      result.error === "cancel_too_late"
        ? (result.fields?.form ?? cancelTooLateMessage)
        : formErrorMessage(result),
    );
  }

  if (mode === "reschedule") {
    return (
      <RescheduleFlow
        appointment={appointment}
        onDone={onDone}
        onProblem={onProblem}
        onBack={() => setMode("idle")}
      />
    );
  }

  // Confirmación dentro de la página: el cartel del navegador se ve mal en el celular.
  if (mode === "confirm") {
    return (
      <div className="flex flex-col gap-3 border-t border-neutral-200 pt-3">
        <p className="font-medium">¿Seguro que quieres cancelar esta cita?</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={submitting}
            className="h-12 flex-1 rounded-xl bg-neutral-900 px-4 text-base font-medium text-white disabled:opacity-60"
          >
            {submitting ? "Cancelando…" : "Sí, cancelar"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className={button}>
            No
          </button>
        </div>
      </div>
    );
  }

  const { canCancel, canReschedule } = appointment;
  return (
    <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
      {(canReschedule || canCancel) && (
        <div className="flex gap-3">
          {canReschedule && (
            <button type="button" onClick={() => setMode("reschedule")} className={button}>
              Reprogramar
            </button>
          )}
          {canCancel && (
            <button type="button" onClick={() => setMode("confirm")} className={button}>
              Cancelar
            </button>
          )}
        </div>
      )}
      {!(canReschedule && canCancel) && (
        <p className="text-sm text-neutral-600">Para cambios, escríbele a Caro.</p>
      )}
    </div>
  );
}
