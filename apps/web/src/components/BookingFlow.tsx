import {
  formatDayShort,
  formatTime,
  formatWhen,
  selectionSummary,
  serviceUnavailableMessage,
  slotTakenMessage,
  summarize,
  type BookingResult,
  type PublicService,
  type PublicUser,
} from "@caro/shared";
import { useCallback, useEffect, useState } from "react";
import { api, formErrorMessage } from "../lib/api";
import { BookingConfirmation } from "./BookingConfirmation";
import { ChoiceGrid } from "./ChoiceGrid";
import { ServicePicker } from "./ServicePicker";

const UNCONFIRMED_MESSAGE =
  "No pudimos confirmar si tu cita quedó guardada. Revisa Mis citas antes de volver a intentarlo.";

// Sin sesión se ingresa primero y después se vuelve aquí.
const LOGIN_URL = `/ingreso?next=${encodeURIComponent("/reservar")}`;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; user: PublicUser; services: PublicService[]; days: string[] };

type Times =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; times: string[] };

const loadError = (error: string) =>
  error === "network"
    ? "No pudimos cargar la agenda. Revisa tu internet e inténtalo de nuevo."
    : "No pudimos cargar la agenda. Inténtalo de nuevo en un momento.";

// Reservar (RF05, RF06): servicios → día → hora → confirmar.
export function BookingFlow() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [date, setDate] = useState<string>();
  const [time, setTime] = useState<string>();
  const [times, setTimes] = useState<Times>({ state: "idle" });
  // Cambiarlo vuelve a pedir las horas (por ejemplo, después de perder una hora).
  const [timesRequest, setTimesRequest] = useState(0);
  // Aviso para la clienta, junto a la parte que tiene que volver a elegir.
  const [notice, setNotice] = useState<{
    text: string;
    at: "services" | "times";
    // Con un corte de internet la cita puede haber quedado guardada: se enlaza a Mis citas.
    checkMine?: boolean;
  }>();
  const [submitting, setSubmitting] = useState(false);
  const [booked, setBooked] = useState<BookingResult>();

  const fetchAll = useCallback(async () => {
    setLoad({ state: "loading" });
    const me = await api.me();
    if (!me.ok && me.status === 401) {
      window.location.replace(LOGIN_URL);
      return;
    }
    if (!me.ok) return setLoad({ state: "error", message: loadError(me.error) });

    const [services, days] = await Promise.all([api.services(), api.bookingDays()]);
    if (!services.ok) return setLoad({ state: "error", message: loadError(services.error) });
    if (!days.ok) return setLoad({ state: "error", message: loadError(days.error) });
    setLoad({
      state: "ready",
      user: me.data.user,
      services: services.data.services,
      days: days.data.days,
    });
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // En el orden del catálogo, que es el que la clienta ve.
  const chosen =
    load.state === "ready" ? load.services.filter((service) => selected.has(service.id)) : [];
  // Como texto, para que el efecto de las horas dependa de un valor estable y no de un
  // arreglo nuevo en cada render.
  const chosenIds = chosen.map((service) => service.id).join(",");

  useEffect(() => {
    if (!date || chosenIds === "") {
      setTimes({ state: "idle" });
      return;
    }
    // Si la clienta cambia de día o de servicios antes de que llegue la respuesta, se descarta.
    let current = true;
    setTimes({ state: "loading" });
    void api.bookingTimes(date, chosenIds.split(",")).then((result) => {
      if (!current) return;
      if (!result.ok && result.error === "service_unavailable") {
        setTimes({ state: "idle" });
        return serviceGone(result.fields?.services);
      }
      setTimes(
        result.ok
          ? { state: "ready", times: result.data.times }
          : { state: "error", message: formErrorMessage(result) },
      );
    });
    return () => {
      current = false;
    };
  }, [date, chosenIds, timesRequest]);

  // Caro desactivó un servicio mientras tanto (al pedir las horas o al confirmar): se
  // recarga el catálogo y la clienta vuelve a elegir, en vez de reintentar lo mismo.
  function serviceGone(text: string | undefined) {
    setNotice({ text: text ?? serviceUnavailableMessage, at: "services" });
    setSelected(new Set());
    setTime(undefined);
    void fetchAll();
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    setTime(undefined);
    setNotice(undefined);
  }

  function chooseDate(value: string) {
    setDate(value);
    setTime(undefined);
    setNotice(undefined);
  }

  async function confirm() {
    if (!date || !time) return;
    setSubmitting(true);
    const result = await api.book({ serviceIds: chosenIds.split(","), date, time });
    setSubmitting(false);

    if (result.ok) return setBooked(result.data);
    if (result.status === 401) return window.location.replace(LOGIN_URL);

    setTime(undefined);
    if (result.error === "slot_taken") {
      setNotice({ text: result.fields?.time ?? slotTakenMessage, at: "times" });
      setTimesRequest((count) => count + 1);
    } else if (result.error === "service_unavailable") {
      serviceGone(result.fields?.services);
    } else {
      setNotice(
        result.error === "network"
          ? { text: UNCONFIRMED_MESSAGE, at: "times", checkMine: true }
          : { text: formErrorMessage(result), at: "times" },
      );
    }
  }

  if (load.state === "loading") {
    return <p className="text-muted">Cargando la agenda…</p>;
  }

  if (load.state === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-danger">
          {load.message}
        </p>
        <button
          type="button"
          onClick={() => void fetchAll()}
          className="h-12 rounded-xl border border-line px-6 text-base font-medium text-ink"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (booked) return <BookingConfirmation result={booked} clientName={load.user.name} />;

  const total = summarize(chosen);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">1. Elige los servicios</h2>
        {notice?.at === "services" && (
          <p role="alert" className="text-danger">
            {notice.text}
          </p>
        )}
        <ServicePicker services={load.services} selected={selected} onToggle={toggle} />
      </section>

      {chosen.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl">2. Elige el día</h2>
          {load.days.length === 0 ? (
            <p className="text-muted">No hay días disponibles por ahora.</p>
          ) : (
            <ChoiceGrid
              label="Días"
              options={load.days.map((day) => ({ value: day, label: formatDayShort(day) }))}
              selected={date}
              onSelect={chooseDate}
            />
          )}
        </section>
      )}

      {chosen.length > 0 && date && (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl">3. Elige la hora</h2>
          {notice?.at === "times" && (
            <p role="alert" className="text-danger">
              {notice.text}
              {notice.checkMine && (
                <>
                  {" "}
                  <a href="/mis-citas" className="font-medium underline">
                    Ir a Mis citas
                  </a>
                </>
              )}
            </p>
          )}
          {times.state === "loading" && <p className="text-muted">Buscando horas…</p>}
          {times.state === "error" && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-danger">
                {times.message}
              </p>
              <button
                type="button"
                onClick={() => setTimesRequest((count) => count + 1)}
                className="h-12 rounded-xl border border-line px-6 text-base font-medium text-ink"
              >
                Reintentar
              </button>
            </div>
          )}
          {times.state === "ready" &&
            (times.times.length === 0 ? (
              <p className="text-muted">No quedan horas libres este día. Prueba con otro.</p>
            ) : (
              <ChoiceGrid
                label="Horas"
                options={times.times.map((value) => ({ value, label: formatTime(value) }))}
                selected={time}
                onSelect={(value) => {
                  setTime(value);
                  setNotice(undefined);
                }}
              />
            ))}
        </section>
      )}

      {chosen.length > 0 && date && time && (
        <section className="flex flex-col gap-3 rounded-xl border border-line p-4">
          <p className="font-medium">{formatWhen(date, time)}</p>
          <p className="text-muted">{selectionSummary(total)}</p>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={submitting}
            className="h-12 rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary disabled:opacity-60"
          >
            {submitting ? "Confirmando…" : "Confirmar reserva"}
          </button>
        </section>
      )}
    </div>
  );
}
