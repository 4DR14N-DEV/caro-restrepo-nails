import type { PublicUser } from "@caro/shared";
import { useEffect, useState } from "react";
import { api, logoutErrorMessage } from "../lib/api";

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
          className="flex h-12 items-center justify-center rounded-xl border border-neutral-300 px-6 text-base font-medium"
        >
          Mis citas
        </a>
        {user.role === "admin" && (
          <a
            href="/admin/servicios"
            className="flex h-12 items-center justify-center rounded-xl border border-neutral-300 px-6 text-base font-medium"
          >
            Administrar servicios
          </a>
        )}
        {user.role === "admin" && (
          <a
            href="/admin/agenda"
            className="flex h-12 items-center justify-center rounded-xl border border-neutral-300 px-6 text-base font-medium"
          >
            Ver agenda
          </a>
        )}
        {user.role === "admin" && (
          <a
            href="/admin/horario"
            className="flex h-12 items-center justify-center rounded-xl border border-neutral-300 px-6 text-base font-medium"
          >
            Horario y reglas
          </a>
        )}
        <button
          type="button"
          onClick={logout}
          className="h-12 rounded-xl border border-neutral-300 px-6 text-base font-medium"
        >
          Salir
        </button>
        {logoutError && (
          <p role="alert" className="text-sm text-red-700">
            {logoutError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
      <a
        href="/registro"
        className="flex h-12 items-center justify-center rounded-xl bg-neutral-900 px-6 text-base font-medium text-white"
      >
        Crear cuenta
      </a>
      <a
        href="/ingreso"
        className="flex h-12 items-center justify-center rounded-xl border border-neutral-300 px-6 text-base font-medium"
      >
        Ingresar
      </a>
    </div>
  );
}
