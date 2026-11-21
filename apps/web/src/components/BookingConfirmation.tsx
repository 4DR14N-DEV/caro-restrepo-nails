import {
  bookingMessage,
  formatDuration,
  formatPrice,
  formatWhen,
  whatsappLink,
  type BookingResult,
} from "@caro/shared";

interface Props {
  result: BookingResult;
  clientName: string;
}

// Cita confirmada, con el botón para avisarle a Caro por WhatsApp con el mensaje ya escrito.
export function BookingConfirmation({ result, clientName }: Props) {
  const { appointment, caroWhatsapp } = result;
  const message = bookingMessage({ name: clientName, ...appointment });

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">¡Listo! Tu cita quedó confirmada.</h2>
      <dl className="flex flex-col gap-2 rounded-xl border border-neutral-300 p-4">
        <div>
          <dt className="text-sm text-neutral-600">Día y hora</dt>
          <dd className="font-medium">{formatWhen(appointment.date, appointment.time)}</dd>
        </div>
        <div>
          <dt className="text-sm text-neutral-600">Servicios</dt>
          <dd className="font-medium">{appointment.services.join(", ")}</dd>
        </div>
        <div>
          <dt className="text-sm text-neutral-600">Duración y total</dt>
          <dd className="font-medium">
            {formatDuration(appointment.durationMinutes)} · {formatPrice(appointment.totalPriceCop)}
          </dd>
        </div>
      </dl>
      {caroWhatsapp && (
        <a
          href={whatsappLink(caroWhatsapp, message)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-12 items-center justify-center rounded-xl bg-neutral-900 px-6 text-base font-medium text-white"
        >
          Avisar a Caro por WhatsApp
        </a>
      )}
      <a
        href="/mis-citas"
        className="flex h-12 items-center justify-center rounded-xl border border-neutral-300 px-6 text-base font-medium"
      >
        Ver mis citas
      </a>
      <a href="/" className="text-center text-sm text-neutral-600 underline">
        Volver al inicio
      </a>
    </section>
  );
}
