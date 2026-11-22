import type { PushSubscriptionInput } from "@caro/shared";

// Avisos push en el navegador de Caro (RF18). El componente usa esta interfaz para
// poder probarlo sin un navegador real.

// "ready": se pueden activar. "ios-install": iPhone o iPad sin instalar la página en la
// pantalla de inicio (Safari solo permite avisos así). "unsupported": no hay avisos.
export type PushSupport = "ready" | "ios-install" | "unsupported";

export interface PushBrowser {
  support(): PushSupport;
  permission(): NotificationPermission;
  // La suscripción de este dispositivo, si ya tiene una.
  subscription(): Promise<PushSubscriptionInput | null>;
  // Pide el permiso (si hace falta) y suscribe el dispositivo con la clave del servidor.
  subscribe(publicKey: string): Promise<PushSubscriptionInput>;
  unsubscribe(): Promise<void>;
}

const SERVICE_WORKER = "/sw.js";

function isIos(): boolean {
  // Los iPad recientes se presentan como Mac, pero con pantalla táctil.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function hasPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// La clave VAPID llega en base64url; el navegador la pide en bytes.
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toInput(subscription: PushSubscription): PushSubscriptionInput {
  return subscription.toJSON() as PushSubscriptionInput;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SERVICE_WORKER);
  return navigator.serviceWorker.ready;
}

export const browserPush: PushBrowser = {
  support() {
    if (hasPush()) return "ready";
    return isIos() ? "ios-install" : "unsupported";
  },
  permission() {
    return Notification.permission;
  },
  async subscription() {
    const current = await (await registration()).pushManager.getSubscription();
    return current ? toInput(current) : null;
  },
  async subscribe(publicKey) {
    const { pushManager } = await registration();
    // Si había una suscripción con otra clave (se cambiaron las claves del servidor), se
    // reemplaza: el navegador no deja suscribirse con dos claves.
    await (await pushManager.getSubscription())?.unsubscribe();
    const subscription = await pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    });
    return toInput(subscription);
  },
  async unsubscribe() {
    await (await (await registration()).pushManager.getSubscription())?.unsubscribe();
  },
};
