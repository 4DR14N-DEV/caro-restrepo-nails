import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { browserPush, type PushBrowser } from "../lib/push";

type State =
  | { kind: "loading" }
  | { kind: "message"; text: string }
  | { kind: "error"; text: string }
  | { kind: "off"; publicKey: string; error?: string }
  | { kind: "on"; publicKey: string; endpoint: string; error?: string };

const BLOCKED =
  "Los avisos están bloqueados en este navegador. Permítelos en los ajustes del sitio para activarlos.";
const IOS_INSTALL =
  'Para recibir avisos en iPhone (iOS 16.4 o más nuevo), abre esta página en Safari, toca Compartir y luego "Agregar a pantalla de inicio". Después ábrela desde ese ícono y activa los avisos.';

// Activa o desactiva los avisos push en este dispositivo de Caro (RF18). Cada dispositivo
// se activa por separado.
export function PushToggle({ browser = browserPush }: { browser?: PushBrowser }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const show = (next: State) => {
      if (active) setState(next);
    };

    async function load() {
      const support = browser.support();
      if (support === "ios-install") return show({ kind: "message", text: IOS_INSTALL });
      if (support === "unsupported") {
        return show({ kind: "message", text: "Este navegador no puede recibir avisos." });
      }

      const key = await api.pushKey();
      if (!key.ok) {
        return show({ kind: "error", text: "No pudimos revisar los avisos. Recarga la página." });
      }
      const { publicKey } = key.data;
      if (!publicKey) {
        return show({ kind: "message", text: "Los avisos todavía no están configurados." });
      }
      if (browser.permission() === "denied") return show({ kind: "message", text: BLOCKED });

      const found = await browser.subscription(publicKey).catch(() => null);
      if (!found) return show({ kind: "off", publicKey });
      const { current } = found;
      // Se cambiaron las claves del servidor: la suscripción vieja ya no recibe avisos. Se
      // borra del servidor (el servicio de push no la da por vencida) y del navegador, y Caro
      // los vuelve a activar.
      if (!found.sameKey) {
        await api.deletePushSubscription(current.endpoint);
        await browser.unsubscribe().catch(() => undefined);
        return show({ kind: "off", publicKey });
      }
      // Se guarda otra vez por si el servidor la había borrado (vencida o de otra cuenta). Si
      // no se pudo, el servidor no tiene a dónde enviar: no se muestra como activa.
      const saved = await api.savePushSubscription(current);
      show(
        saved.ok
          ? { kind: "on", publicKey, endpoint: current.endpoint }
          : {
              kind: "off",
              publicKey,
              error: "No pudimos confirmar los avisos en este dispositivo. Actívalos otra vez.",
            },
      );
    }

    void load();
    return () => {
      active = false;
    };
  }, [browser]);

  async function turnOn(publicKey: string) {
    setBusy(true);
    try {
      let subscription;
      try {
        subscription = await browser.subscribe(publicKey);
      } catch {
        setState(
          browser.permission() === "denied"
            ? { kind: "message", text: BLOCKED }
            : {
                kind: "off",
                publicKey,
                error: "No pudimos activar los avisos. Inténtalo de nuevo.",
              },
        );
        return;
      }
      const saved = await api.savePushSubscription(subscription);
      setState(
        saved.ok
          ? { kind: "on", publicKey, endpoint: subscription.endpoint }
          : { kind: "off", publicKey, error: "No pudimos activar los avisos. Inténtalo de nuevo." },
      );
    } finally {
      setBusy(false);
    }
  }

  // Primero se borra en el servidor: si falla, el dispositivo sigue suscrito y recibiendo.
  async function turnOff(publicKey: string, endpoint: string) {
    setBusy(true);
    try {
      const deleted = await api.deletePushSubscription(endpoint);
      if (!deleted.ok) {
        setState({
          kind: "on",
          publicKey,
          endpoint,
          error: "No pudimos desactivar los avisos. Inténtalo de nuevo.",
        });
        return;
      }
      await browser.unsubscribe().catch(() => undefined);
      setState({ kind: "off", publicKey });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex w-full flex-col items-center gap-3 rounded-xl border border-line-soft p-4">
      <h2 className="font-medium">Avisos de citas</h2>
      {state.kind === "loading" && <p className="text-sm text-muted">Cargando…</p>}
      {state.kind === "message" && <p className="text-sm text-muted">{state.text}</p>}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.text}
        </p>
      )}
      {state.kind === "off" && (
        <>
          <p className="text-sm text-muted">
            Recibe un aviso cuando una clienta reserva, cancela o reprograma.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => turnOn(state.publicKey)}
            className="h-12 rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary disabled:opacity-50"
          >
            Activar avisos en este dispositivo
          </button>
        </>
      )}
      {state.kind === "on" && (
        <>
          <p className="text-sm text-muted">Los avisos están activos en este dispositivo.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => turnOff(state.publicKey, state.endpoint)}
            className="h-12 rounded-xl border border-line px-6 text-base font-medium disabled:opacity-50 text-ink"
          >
            Desactivar avisos
          </button>
        </>
      )}
      {(state.kind === "off" || state.kind === "on") && state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </section>
  );
}
