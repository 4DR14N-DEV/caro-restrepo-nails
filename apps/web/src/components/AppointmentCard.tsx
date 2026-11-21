import {
  formatDuration,
  formatPrice,
  formatWhen,
  type AppointmentState,
  type MyAppointment,
} from "@caro/shared";

const STATE_LABELS: Record<AppointmentState, string> = {
  upcoming: "Confirmada",
  past: "Pasada",
  completed: "Completada",
  no_show: "No asistió",
  cancelled: "Cancelada",
};

// Una cita en "Mis citas": cuándo, qué servicios, cuánto dura, cuánto cuesta y su estado.
export function AppointmentCard({ appointment }: { appointment: MyAppointment }) {
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-neutral-300 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{formatWhen(appointment.date, appointment.time)}</p>
        <span className="shrink-0 rounded-full border border-neutral-300 px-2 py-0.5 text-sm">
          {STATE_LABELS[appointment.state]}
        </span>
      </div>
      <p className="text-neutral-700">{appointment.services.join(", ")}</p>
      <p className="text-sm text-neutral-600">
        {formatDuration(appointment.durationMinutes)} · {formatPrice(appointment.totalPriceCop)}
      </p>
    </li>
  );
}
