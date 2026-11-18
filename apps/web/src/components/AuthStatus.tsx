import type { PublicUser } from "@caro/shared";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Muestra los enlaces de ingreso o, si hay sesión, el saludo y el botón para salir.
export function AuthStatus() {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);

  useEffect(() => {
    api.me().then((result) => setUser(result.ok ? result.data.user : null));
  }, []);

  async function logout() {
    await api.logout();
    setUser(null);
  }

  // Mientras se consulta la sesión se reserva el espacio para que la página no salte.
  if (user === undefined) return <div className="h-12" aria-hidden="true" />;

  if (user) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p>
          Hola, <span className="font-medium">{user.name}</span>.
        </p>
        <button
          type="button"
          onClick={logout}
          className="h-12 rounded-xl border border-neutral-300 px-6 text-base font-medium"
        >
          Salir
        </button>
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
