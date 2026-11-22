import { z } from "zod";
import { formatWhen, joinNames } from "./booking.js";

// Avisos push para Caro (RF18), compartido por la API y la web.

// Claves de la suscripción en base64url, como las entrega el navegador.
const keySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+=*$/);

// Lo que devuelve `PushSubscription.toJSON()` en el navegador. Solo https: la API le
// envía los avisos a esa dirección.
export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: keySchema, auth: keySchema }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushEndpointSchema = z.object({
  endpoint: z.string().min(1).max(2048),
});

// Clave pública VAPID para suscribirse; null si el servidor no tiene claves configuradas.
export interface PushKey {
  publicKey: string | null;
}

// Lo que el service worker recibe en cada aviso: título, texto y la página que abre.
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

// Lo que hizo una clienta con una cita, para avisarle a Caro (RF18). `date` y `time` son la
// fecha y hora en Bogotá de la cita (la nueva, si se reprogramó).
export type AppointmentNotice = {
  clientName: string;
  services: readonly string[];
  date: string;
  time: string;
} & (
  { kind: "booked" | "cancelled" } | { kind: "rescheduled"; from: { date: string; time: string } }
);

const NOTICE_TITLES = {
  booked: "Nueva cita",
  cancelled: "Cita cancelada",
  rescheduled: "Cita reprogramada",
} as const;

// "Nueva cita" · "{nombre}, {servicios}, {día} a las {hora}"; al tocarlo abre la agenda en
// el día de la cita.
export function appointmentNoticePayload(notice: AppointmentNotice): PushPayload {
  const when =
    notice.kind === "rescheduled"
      ? `del ${formatWhen(notice.from.date, notice.from.time)} al ${formatWhen(notice.date, notice.time)}`
      : formatWhen(notice.date, notice.time);
  return {
    title: NOTICE_TITLES[notice.kind],
    body: `${notice.clientName}, ${joinNames(notice.services)}, ${when}`,
    url: `/admin/agenda?dia=${notice.date}`,
  };
}
