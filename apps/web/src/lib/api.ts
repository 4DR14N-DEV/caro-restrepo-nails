import type { PublicService, PublicUser } from "@caro/shared";

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
  services: () => call<{ services: PublicService[] }>("GET", "/api/services"),
};

// Mensaje para mostrar arriba del formulario cuando la API rechaza el envío.
export function formErrorMessage(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  switch (result.error) {
    case "invalid_credentials":
      return "Celular o contraseña incorrectos.";
    case "too_many_attempts":
      // Cada límite bloquea por un tiempo distinto: sin la espera del servidor no se adivina.
      return result.retryAfterSeconds === undefined
        ? "Demasiados intentos. Vuelve a intentarlo más tarde."
        : `Demasiados intentos. Vuelve a intentarlo en ${waitTime(result.retryAfterSeconds)}.`;
    case "network":
      return "No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo.";
    default:
      return "Algo salió mal. Inténtalo de nuevo en un momento.";
  }
}

// Espera legible en minutos (redondeando hacia arriba), o en horas si llega a 60 minutos.
function waitTime(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes >= 60) {
    const hours = Math.ceil(minutes / 60);
    return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  }
  return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

export const logoutErrorMessage = "No pudimos cerrar tu sesión. Inténtalo de nuevo.";
