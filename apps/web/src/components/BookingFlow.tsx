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
  const [notice, setNotice] = useState<{ text: string; at: "services" | "times" }>();
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
      // Caro desactivó un servicio mientras tanto: se recarga el catálogo y se vuelve a elegir.
      setNotice({ text: result.fields?.services ?? serviceUnavailableMessage, at: "services" });
      setSelected(new Set());
      void fetchAll();
    } else {
      setNotice({ text: formErrorMessage(result), at: "times" });
    }
  }

  if (load.state === "loading") {
    return <p className="text-neutral-600">Cargando la agenda…</p>;
  }

  if (load.state === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-red-700">
          {load.message}
        </p>
        <button
          type="button"
          onClick={() => void fetchAll()}
          className="h-12 rounded-xl border border-neutral-300 px-6 text-base font-medium"
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
        <h2 className="text-lg font-semibold">1. Elige los servicios</h2>
        {notice?.at === "services" && (
          <p role="alert" className="text-red-700">
            {notice.text}
          </p>
        )}
        <ServicePicker services={load.services} selected={selected} onToggle={toggle} />
      </section>

      {chosen.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">2. Elige el día</h2>
          {load.days.length === 0 ? (
            <p className="text-neutral-600">No hay días disponibles por ahora.</p>
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
          <h2 className="text-lg font-semibold">3. Elige la hora</h2>
          {notice?.at === "times" && (
            <p role="alert" className="text-red-700">
              {notice.text}
            </p>
          )}
          {times.state === "loading" && <p className="text-neutral-600">Buscando horas…</p>}
          {times.state === "error" && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-red-700">
                {times.message}
              </p>
              <button
                type="button"
                onClick={() => setTimesRequest((count) => count + 1)}
                className="h-12 rounded-xl border border-neutral-300 px-6 text-base font-medium"
              >
                Reintentar
              </button>
            </div>
          )}
          {times.state === "ready" &&
            (times.times.length === 0 ? (
              <p className="text-neutral-600">No quedan horas libres este día. Prueba con otro.</p>
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
        <section className="flex flex-col gap-3 rounded-xl border border-neutral-300 p-4">
          <p className="font-medium">{formatWhen(date, time)}</p>
          <p className="text-neutral-600">{selectionSummary(total)}</p>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={submitting}
            className="h-12 rounded-xl bg-neutral-900 px-6 text-base font-medium text-white disabled:opacity-60"
          >
            {submitting ? "Confirmando…" : "Confirmar reserva"}
          </button>
        </section>
      )}
    </div>
  );
}
