import type { MyAppointments as Appointments } from "@caro/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { AppointmentActions } from "./AppointmentActions";
import { AppointmentCard } from "./AppointmentCard";
import { ChangeDone, type Change } from "./ChangeDone";
import { MyAccount } from "./MyAccount";

// Sin sesión se ingresa primero y después se vuelve aquí.
const LOGIN_URL = `/ingreso?next=${encodeURIComponent("/mis-citas")}`;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; appointments: Appointments; clientName: string; isClient: boolean };

const loadError = (error: string) =>
  error === "network"
    ? "No pudimos cargar tus citas. Revisa tu internet e inténtalo de nuevo."
    : "No pudimos cargar tus citas. Inténtalo de nuevo en un momento.";

// Mis citas (RF07): las próximas, con cancelar y reprogramar (RF08, RF09), y el historial.
export function MyAppointments() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // El último cambio hecho, o un aviso de algo que no se pudo hacer.
  const [done, setDone] = useState<Change>();
  const [notice, setNotice] = useState<string>();

  // `quiet` recarga sin volver a "Cargando…", para que la lista no parpadee después de un cambio.
  const fetchAppointments = useCallback(async (quiet = false) => {
    if (!quiet) setLoad({ state: "loading" });
    const [me, result] = await Promise.all([api.me(), api.myAppointments()]);
    if ((!me.ok && me.status === 401) || (!result.ok && result.status === 401)) {
      return window.location.replace(LOGIN_URL);
    }
    if (!me.ok) return setLoad({ state: "error", message: loadError(me.error) });
    if (!result.ok) return setLoad({ state: "error", message: loadError(result.error) });
    setLoad({
      state: "ready",
      appointments: result.data,
      clientName: me.data.user.name,
      isClient: me.data.user.role === "client",
    });
  }, []);

  useEffect(() => {
    void fetchAppointments();
  }, [fetchAppointments]);

  const changed = useCallback(
    (change: Change) => {
      setDone(change);
      setNotice(undefined);
      void fetchAppointments(true);
    },
    [fetchAppointments],
  );

  const problem = useCallback(
    (message: string) => {
      setNotice(message);
      setDone(undefined);
      void fetchAppointments(true);
    },
    [fetchAppointments],
  );

  if (load.state === "loading") {
    return <p className="text-neutral-600">Cargando tus citas…</p>;
  }

  if (load.state === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-red-700">
          {load.message}
        </p>
        <button
          type="button"
          onClick={() => void fetchAppointments()}
          className="h-12 rounded-xl border border-neutral-300 px-6 text-base font-medium"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const { upcoming, history } = load.appointments;

  return (
    <div className="flex flex-col gap-8">
      {done && <ChangeDone change={done} clientName={load.clientName} />}
      {notice && (
        <p role="alert" className="text-red-700">
          {notice}
        </p>
      )}

      <section aria-labelledby="proximas" className="flex flex-col gap-3">
        <h2 id="proximas" className="text-lg font-semibold">
          Próximas
        </h2>
        {upcoming.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-neutral-600">No tienes citas próximas.</p>
            <a
              href="/reservar"
              className="flex h-12 items-center justify-center rounded-xl bg-neutral-900 px-6 text-base font-medium text-white"
            >
              Reservar cita
            </a>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((appointment) => (
              <AppointmentCard key={appointment.id} appointment={appointment}>
                <AppointmentActions
                  appointment={appointment}
                  onDone={changed}
                  onProblem={problem}
                />
              </AppointmentCard>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="historial" className="flex flex-col gap-3">
        <h2 id="historial" className="text-lg font-semibold">
          Historial
        </h2>
        {history.length === 0 ? (
          <p className="text-neutral-600">Todavía no tienes citas pasadas.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {history.map((appointment) => (
              <AppointmentCard key={appointment.id} appointment={appointment} />
            ))}
          </ul>
        )}
      </section>

      <MyAccount canDelete={load.isClient} />
    </div>
  );
}
