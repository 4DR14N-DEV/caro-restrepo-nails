import type { PublicUser } from "@caro/shared";
import { useEffect, useState } from "react";
import { api, logoutErrorMessage } from "../lib/api";
import { PushToggle } from "./PushToggle";

// Después de borrar la cuenta (RF22), Mis citas trae a la clienta aquí con ?cuenta=borrada.
function accountDeleted(): boolean {
  return new URLSearchParams(window.location.search).get("cuenta") === "borrada";
}

// Muestra los enlaces de ingreso o, si hay sesión, el saludo y el botón para salir.
export function AuthStatus() {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const [logoutError, setLogoutError] = useState<string>();

  useEffect(() => {
    api.me().then((result) => setUser(result.ok ? result.data.user : null));
  }, []);

  // Solo se muestra como "afuera" si el servidor confirmó que cerró la sesión; si no,
  // la cookie sigue valiendo y hay que decírselo a la clienta.
  async function logout() {
    const result = await api.logout();
    if (result.ok) {
      setLogoutError(undefined);
      setUser(null);
    } else {
      setLogoutError(logoutErrorMessage);
    }
  }

  // Mientras se consulta la sesión se reserva el espacio para que la página no salte.
  if (user === undefined) return <div className="h-12" aria-hidden="true" />;

  if (user) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p>
          Hola, <span className="font-medium">{user.name}</span>.
        </p>
        <a
          href="/mis-citas"
          className="flex h-12 items-center justify-center rounded-xl border border-line px-6 text-base font-medium text-ink"
        >
          Mis citas
        </a>
        {user.role === "admin" && (
          <a
            href="/admin/servicios"
            className="flex h-12 items-center justify-center rounded-xl border border-line px-6 text-base font-medium text-ink"
          >
            Administrar servicios
          </a>
        )}
        {user.role === "admin" && (
          <a
            href="/admin/agenda"
            className="flex h-12 items-center justify-center rounded-xl border border-line px-6 text-base font-medium text-ink"
          >
            Ver agenda
          </a>
        )}
        {user.role === "admin" && (
          <a
            href="/admin/horario"
            className="flex h-12 items-center justify-center rounded-xl border border-line px-6 text-base font-medium text-ink"
          >
            Horario y reglas
          </a>
        )}
        {user.role === "admin" && (
          <a
            href="/admin/clientas"
            className="flex h-12 items-center justify-center rounded-xl border border-line px-6 text-base font-medium text-ink"
          >
            Clientas
          </a>
        )}
        {user.role === "admin" && <PushToggle />}
        <button
          type="button"
          onClick={logout}
          className="h-12 rounded-xl border border-line px-6 text-base font-medium text-ink"
        >
          Salir
        </button>
        {logoutError && (
          <p role="alert" className="text-sm text-danger">
            {logoutError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {accountDeleted() && (
        <p
          role="status"
          className="rounded-xl bg-success-soft px-4 py-3 text-center text-sm text-success"
        >
          Tu cuenta fue borrada.
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <a
          href="/registro"
          className="flex h-12 items-center justify-center rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary"
        >
          Crear cuenta
        </a>
        <a
          href="/ingreso"
          className="flex h-12 items-center justify-center rounded-xl border border-line px-6 text-base font-medium text-ink"
        >
          Ingresar
        </a>
      </div>
    </div>
  );
}
