import {
  formatDay,
  newPasswordMessage,
  whatsappLink,
  type ClientRow,
  type PasswordReset,
} from "@caro/shared";
import { useCallback, useEffect, useState } from "react";
import { api, formErrorMessage, type ApiResult } from "../lib/api";

type Load =
  | { state: "loading" }
  | { state: "signed-out" }
  | { state: "forbidden" }
  | { state: "error"; message: string }
  | { state: "ready"; clients: ClientRow[] };

const LOGIN_URL = `/ingreso?next=${encodeURIComponent("/admin/clientas")}`;

const buttonClass = "h-11 rounded-xl border border-neutral-300 px-4 text-sm font-medium";

// Sin mayúsculas ni tildes: "María" se encuentra escribiendo "maria".
const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// Por nombre, o por los dígitos del celular desde 3 (como la búsqueda de "Nueva cita").
function matches(client: ClientRow, query: string): boolean {
  const text = plain(query.trim());
  if (!text) return true;
  const digits = query.replace(/\D/g, "");
  return plain(client.name).includes(text) || (digits.length >= 3 && client.phone.includes(digits));
}

function upcomingText(count: number): string {
  if (count === 0) return "Sin citas próximas";
  return count === 1 ? "1 cita próxima" : `${count} citas próximas`;
}

// Panel de Caro: las clientas con cuenta y una contraseña nueva si olvidan la suya (RF17).
export function AdminClients() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [query, setQuery] = useState("");
  // La clienta a la que se le está por generar la clave (paso de confirmación).
  const [confirming, setConfirming] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<PasswordReset>();
  const [problem, setProblem] = useState<string>();

  const fetchClients = useCallback(async () => {
    setLoad({ state: "loading" });
    const result = await api.adminClients();
    if (result.ok) return setLoad({ state: "ready", clients: result.data.clients });
    if (result.status === 401) return setLoad({ state: "signed-out" });
    if (result.status === 403) return setLoad({ state: "forbidden" });
    setLoad({
      state: "error",
      message:
        result.error === "network"
          ? "No pudimos cargar las clientas. Revisa tu internet e inténtalo de nuevo."
          : "No pudimos cargar las clientas. Inténtalo de nuevo en un momento.",
    });
  }, []);

  useEffect(() => {
    void fetchClients();
  }, [fetchClients]);

  // Sin sesión o sin permiso: el panel cambia de estado en vez de pedir que reintente.
  function lostAccess(result: Extract<ApiResult<unknown>, { ok: false }>): boolean {
    if (result.status !== 401 && result.status !== 403) return false;
    setLoad({ state: result.status === 401 ? "signed-out" : "forbidden" });
    return true;
  }

  async function generate(client: ClientRow) {
    setBusy(true);
    setProblem(undefined);
    const result = await api.resetClientPassword(client.id);
    setBusy(false);
    setConfirming(undefined);
    if (result.ok) return setReset(result.data);
    if (lostAccess(result)) return;
    setProblem(
      result.status === 404 ? "Esa clienta ya no está disponible." : formErrorMessage(result),
    );
  }

  if (load.state === "loading") return <p className="text-neutral-600">Cargando clientas…</p>;

  if (load.state === "signed-out") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>Ingresa con la cuenta de Caro para ver las clientas.</p>
        <a
          href={LOGIN_URL}
          className="flex h-12 items-center rounded-xl bg-neutral-900 px-6 text-base font-medium text-white"
        >
          Ingresar
        </a>
      </div>
    );
  }

  if (load.state === "forbidden") return <p>Esta página es solo para Caro.</p>;

  if (load.state === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-red-700">
          {load.message}
        </p>
        <button type="button" onClick={() => void fetchClients()} className={buttonClass}>
          Reintentar
        </button>
      </div>
    );
  }

  if (load.clients.length === 0) {
    return <p className="text-neutral-600">Todavía no hay clientas registradas.</p>;
  }

  const shown = load.clients.filter((client) => matches(client, query));

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Buscar por nombre o celular
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-11 rounded-xl border border-neutral-300 px-3 text-base"
        />
      </label>
      <p className="text-sm text-neutral-600">
        {load.clients.length === 1 ? "1 clienta" : `${load.clients.length} clientas`}
      </p>

      {problem && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {problem}
        </p>
      )}
      {reset && (
        <div role="status" className="flex flex-col gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm">
          <span>Contraseña nueva de {reset.client.name}:</span>
          <strong className="font-mono text-lg tracking-wider">{reset.password}</strong>
          <span className="text-neutral-700">Solo se muestra esta vez.</span>
          <a
            href={whatsappLink(
              reset.client.phone,
              newPasswordMessage({ name: reset.client.name, password: reset.password }),
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-11 items-center justify-center rounded-xl bg-green-700 px-4 font-medium text-white"
          >
            Enviar por WhatsApp
          </a>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-neutral-600">No hay clientas con ese nombre o celular.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((client) => (
            <li
              key={client.id}
              className="flex flex-col gap-2 rounded-xl border border-neutral-300 px-4 py-3"
            >
              <p className="font-medium">{client.name}</p>
              <a href={`tel:${client.phone}`} className="text-sm underline">
                {client.phone}
              </a>
              <span className="text-sm text-neutral-600">
                {`Registrada el ${formatDay(client.registeredOn)} de ${client.registeredOn.slice(0, 4)}`}
              </span>
              <span className="text-sm">{upcomingText(client.upcoming)}</span>
              {confirming === client.id ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm">
                    {`¿Generar una contraseña nueva para ${client.name}? La actual deja de servir.`}
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void generate(client)}
                      className="h-11 rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {busy ? "Generando…" : "Generar contraseña"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirming(undefined)}
                      className={buttonClass}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(client.id);
                    setReset(undefined);
                    setProblem(undefined);
                  }}
                  className={`${buttonClass} self-start`}
                >
                  Restablecer contraseña
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
