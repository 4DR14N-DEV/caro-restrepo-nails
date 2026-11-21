import type { MyAppointments as Appointments } from "@caro/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { AppointmentCard } from "./AppointmentCard";

// Sin sesión se ingresa primero y después se vuelve aquí.
const LOGIN_URL = `/ingreso?next=${encodeURIComponent("/mis-citas")}`;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; appointments: Appointments };

// Mis citas (RF07): las próximas y el historial de la clienta.
export function MyAppointments() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const fetchAppointments = useCallback(async () => {
    setLoad({ state: "loading" });
    const result = await api.myAppointments();
    if (result.ok) return setLoad({ state: "ready", appointments: result.data });
    if (result.status === 401) return window.location.replace(LOGIN_URL);
    setLoad({
      state: "error",
      message:
        result.error === "network"
          ? "No pudimos cargar tus citas. Revisa tu internet e inténtalo de nuevo."
          : "No pudimos cargar tus citas. Inténtalo de nuevo en un momento.",
    });
  }, []);

  useEffect(() => {
    void fetchAppointments();
  }, [fetchAppointments]);

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
              <AppointmentCard key={appointment.id} appointment={appointment} />
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
    </div>
  );
}
