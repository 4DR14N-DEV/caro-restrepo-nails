import type {
  AdminAppointmentRequest,
  AgendaAppointment,
  ClientSummary,
  PublicService,
} from "@caro/shared";
import { useEffect, useState, type SubmitEvent } from "react";
import { api, formErrorMessage } from "../lib/api";
import { ServicePicker } from "./ServicePicker";

// Horas en pasos de 15 minutos, todo el día: Caro no tiene las restricciones de las clientas.
const HOURS = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

type Client = { id: string; name: string; phone: string | null };

interface Props {
  // El día que se está viendo: por defecto, la cita nueva va ese día.
  date: string;
  today: string;
  // Sin cita es una cita nueva; con cita, se edita.
  appointment?: AgendaAppointment;
  onSaved: (saved: AgendaAppointment) => void;
  onCancel: () => void;
}

const input = "h-11 rounded-xl border border-line px-3 text-base text-ink bg-surface";

// Crear o editar una cita a nombre de una clienta (RF11): clienta, servicios, día y hora.
export function AppointmentForm({ date, today, appointment, onSaved, onCancel }: Props) {
  const [client, setClient] = useState<Client | undefined>(appointment?.client);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientSummary[]>([]);
  const [services, setServices] = useState<PublicService[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(appointment?.serviceIds ?? []),
  );
  const [day, setDay] = useState(appointment?.date ?? date);
  const [time, setTime] = useState(appointment?.time ?? "09:00");
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.services().then((result) => {
      if (result.ok) setServices(result.data.services);
    });
  }, []);

  // La búsqueda pide resultados desde 2 letras; una respuesta vieja no pisa a una nueva.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let current = true;
    void api.searchClients(query.trim()).then((result) => {
      if (current && result.ok) setResults(result.data.clients);
    });
    return () => {
      current = false;
    };
  }, [query]);

  function toggle(id: string) {
    setSelected((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return setProblem("Elige una clienta.");
    // En el orden del catálogo; los de la cita que ya no están activos se conservan al final.
    const serviceIds = [
      ...services.filter((service) => selected.has(service.id)).map((service) => service.id),
      ...[...selected].filter((id) => !services.some((service) => service.id === id)),
    ];
    const body: AdminAppointmentRequest = { clientId: client.id, serviceIds, date: day, time };
    setBusy(true);
    const result = appointment
      ? await api.updateAppointment(appointment.id, body)
      : await api.createAppointment(body);
    setBusy(false);
    if (result.ok) return onSaved(result.data.appointment);
    setProblem(
      result.fields?.form ?? Object.values(result.fields ?? {})[0] ?? formErrorMessage(result),
    );
  }

  return (
    <form
      aria-label="Cita"
      onSubmit={(event) => void save(event)}
      className="flex flex-col gap-4 rounded-xl border border-accent p-4"
    >
      <h3 className="font-medium">{appointment ? "Editar cita" : "Nueva cita"}</h3>

      {client ? (
        <div className="flex items-center justify-between gap-3">
          <p>
            Clienta: {client.name}
            {client.phone && ` · ${client.phone}`}
          </p>
          <button
            type="button"
            onClick={() => setClient(undefined)}
            className="h-11 rounded-xl border border-line px-4 text-sm text-ink"
          >
            Cambiar
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Buscar clienta
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre o celular"
              className={input}
            />
          </label>
          {results.length > 0 && (
            <ul className="flex flex-col gap-1">
              {results.map((found) => (
                <li key={found.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setClient(found);
                      setQuery("");
                    }}
                    className="h-10 w-full rounded-lg border border-line px-3 text-left text-sm"
                  >
                    {found.name} · {found.phone}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ServicePicker services={services} selected={selected} onToggle={toggle} />

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Día
          <input
            type="date"
            value={day}
            min={today}
            onChange={(event) => setDay(event.target.value)}
            className={input}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Hora
          <select value={time} onChange={(event) => setTime(event.target.value)} className={input}>
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hour}
              </option>
            ))}
          </select>
        </label>
      </div>

      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="h-11 flex-1 rounded-xl bg-primary hover:bg-primary-hover px-4 text-sm font-medium text-on-primary disabled:opacity-60"
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 flex-1 rounded-xl border border-line px-4 text-sm font-medium text-ink"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
