import type { PublicUser } from "@caro/shared";

// Resultado de una llamada a la API: éxito con datos, o el código de error que devolvió.
export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      error: string;
      fields?: Record<string, string>;
      retryAfterSeconds?: number;
    };

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };

  const { error, fields } = (payload ?? {}) as { error?: string; fields?: Record<string, string> };
  const retryAfter = Number(response.headers.get("Retry-After"));
  return {
    ok: false,
    status: response.status,
    error: error ?? "unknown",
    ...(fields ? { fields } : {}),
    ...(retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
  };
}

export const api = {
  register: (body: unknown) => call<{ user: PublicUser }>("POST", "/api/auth/register", body),
  login: (body: unknown) => call<{ user: PublicUser }>("POST", "/api/auth/login", body),
  logout: () => call<null>("POST", "/api/auth/logout"),
  me: () => call<{ user: PublicUser }>("GET", "/api/auth/me"),
};

// Mensaje para mostrar arriba del formulario cuando la API rechaza el envío.
export function formErrorMessage(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  switch (result.error) {
    case "invalid_credentials":
      return "Celular o contraseña incorrectos.";
    case "too_many_attempts": {
      const minutes = Math.ceil((result.retryAfterSeconds ?? 900) / 60);
      return `Demasiados intentos. Vuelve a intentarlo en ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`;
    }
    case "network":
      return "No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo.";
    default:
      return "Algo salió mal. Inténtalo de nuevo en un momento.";
  }
}
