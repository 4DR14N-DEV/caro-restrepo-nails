import webpush from "web-push";

// Una suscripción guardada: a dónde enviar el aviso y con qué claves cifrarlo.
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// "gone": el servicio de push dice que la suscripción ya no existe (404 o 410) y hay que
// borrarla. Cualquier otro fallo se lanza como error.
export type PushResult = "sent" | "gone";

// Envía avisos push (RF18). Los tests usan uno falso; producción, `webPushService`.
export interface PushService {
  publicKey: string;
  send(target: PushTarget, payload: string): Promise<PushResult>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  // Contacto para el servicio de push: "mailto:…" o una URL https.
  subject: string;
}

// Tiempo máximo por envío: el aviso sale antes de responder a la clienta y no puede
// demorar su reserva.
const SEND_TIMEOUT_MS = 3000;

// Cuánto guarda el servicio de push un aviso si el dispositivo está apagado: un día.
const TTL_SECONDS = 24 * 60 * 60;

export function webPushService(config: VapidConfig): PushService {
  return {
    publicKey: config.publicKey,
    async send(target, payload) {
      try {
        await webpush.sendNotification(target, payload, {
          vapidDetails: config,
          timeout: SEND_TIMEOUT_MS,
          TTL: TTL_SECONDS,
          urgency: "high",
        });
        return "sent";
      } catch (error) {
        if (error instanceof webpush.WebPushError && [404, 410].includes(error.statusCode)) {
          return "gone";
        }
        throw error;
      }
    },
  };
}

// Lee las claves VAPID del entorno. Sin ninguna, no hay avisos (desarrollo); si falta
// solo alguna, se avisa en el log para no perderlos sin saberlo.
export function pushServiceFromEnv(env: NodeJS.ProcessEnv): PushService | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (publicKey && privateKey && subject) {
    return webPushService({ publicKey, privateKey, subject });
  }
  if (publicKey || privateKey || subject) {
    console.error(
      "Faltan variables VAPID (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT): los avisos push quedan apagados.",
    );
  }
  return null;
}
