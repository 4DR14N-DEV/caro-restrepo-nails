import {
  formatDuration,
  formatPrice,
  formatTime,
  reminderMessage,
  whatsappLink,
  type AgendaAppointment,
  type AppointmentStatus,
  type MarkedStatus,
} from "@caro/shared";
import { useState } from "react";

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Agendada",
  completed: "Completada",
  no_show: "No asistió",
  cancelled: "Cancelada",
};

interface Props {
  appointment: AgendaAppointment;
  // Devuelve cuando la API respondió (bien o mal); mientras tanto los botones esperan.
  onMark: (status: MarkedStatus) => Promise<void>;
  // Editar la cita (día, hora, servicios, clienta); solo las agendadas.
  onEdit?: () => void;
}

const button = "h-11 flex-1 rounded-xl border border-line px-3 text-sm font-medium text-ink";

// Una cita de la agenda de Caro, con lo que puede hacer con ella: marcarla (si ya empezó),
// cancelarla (si está agendada) y recordársela a la clienta por WhatsApp.
export function AgendaCard({ appointment, onMark, onEdit }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { client, status } = appointment;

  async function mark(next: MarkedStatus) {
    setBusy(true);
    await onMark(next);
    setBusy(false);
    setConfirming(false);
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{formatTime(appointment.time)}</p>
        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-sm">
          {STATUS_LABELS[status]}
        </span>
      </div>
      <p>
        {client.name}
        {client.phone && (
          <>
            {" · "}
            <a href={`tel:${client.phone}`} className="underline">
              {client.phone}
            </a>
          </>
        )}
      </p>
      <p className="text-muted">{appointment.services.join(", ")}</p>
      <p className="text-sm text-muted">
        {formatDuration(appointment.durationMinutes)} · {formatPrice(appointment.totalPriceCop)}
      </p>

      {confirming ? (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
          <p className="font-medium">¿Seguro que quieres cancelar esta cita?</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void mark("cancelled")}
              className="h-11 flex-1 rounded-xl bg-primary hover:bg-primary-hover px-3 text-sm font-medium text-on-primary disabled:opacity-60"
            >
              {busy ? "Cancelando…" : "Sí, cancelar"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={button}>
              No
            </button>
          </div>
        </div>
      ) : (
        (appointment.canMark || appointment.canCancel) && (
          <div className="flex gap-2 border-t border-line-soft pt-3">
            {appointment.canMark && (
              <>
                <button
                  type="button"
                  aria-pressed={status === "completed"}
                  disabled={busy}
                  onClick={() => void mark("completed")}
                  className={button}
                >
                  Completada
                </button>
                <button
                  type="button"
                  aria-pressed={status === "no_show"}
                  disabled={busy}
                  onClick={() => void mark("no_show")}
                  className={button}
                >
                  No asistió
                </button>
              </>
            )}
            {appointment.canCancel && (
              <button type="button" onClick={() => setConfirming(true)} className={button}>
                Cancelar
              </button>
            )}
            {status === "scheduled" && onEdit && (
              <button type="button" onClick={onEdit} className={button}>
                Editar
              </button>
            )}
          </div>
        )
      )}

      {status === "scheduled" && client.phone && (
        <a
          href={whatsappLink(
            client.phone,
            reminderMessage({ clientName: client.name, ...appointment }),
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium underline"
        >
          Recordar por WhatsApp
        </a>
      )}
    </li>
  );
}
