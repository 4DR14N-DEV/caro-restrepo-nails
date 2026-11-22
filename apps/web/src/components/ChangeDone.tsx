import {
  cancelMessage,
  formatWhen,
  rescheduleMessage,
  whatsappLink,
  type MyAppointment,
} from "@caro/shared";

// Un cambio que la clienta acaba de hacer en una cita.
export type Change =
  | { kind: "cancelled"; before: MyAppointment; caroWhatsapp: string | null }
  | { kind: "moved"; before: MyAppointment; after: MyAppointment; caroWhatsapp: string | null };

interface Props {
  change: Change;
  clientName: string;
}

// Confirma el cambio y ofrece avisarle a Caro por WhatsApp con el mensaje ya escrito.
export function ChangeDone({ change, clientName }: Props) {
  const { before, caroWhatsapp } = change;
  const message =
    change.kind === "cancelled"
      ? cancelMessage({ name: clientName, ...before })
      : rescheduleMessage({
          name: clientName,
          services: before.services,
          from: before,
          to: change.after,
        });

  return (
    <div role="status" className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <p className="font-medium">
        {change.kind === "cancelled"
          ? "Tu cita quedó cancelada."
          : `Tu cita quedó para el ${formatWhen(change.after.date, change.after.time)}.`}
      </p>
      {caroWhatsapp && (
        <a
          href={whatsappLink(caroWhatsapp, message)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-12 items-center justify-center rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary"
        >
          Avisar a Caro por WhatsApp
        </a>
      )}
    </div>
  );
}
