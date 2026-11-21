import type {
  AdminService,
  Agenda,
  AgendaChange,
  AppointmentChange,
  MarkedStatus,
  BookingRequest,
  BookingResult,
  MyAppointments,
  PublicService,
  PublicUser,
  ServiceData,
  ServiceUpdate,
} from "@caro/shared";

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
  method: "GET" | "POST" | "PATCH",
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
  adminServices: () => call<{ services: AdminService[] }>("GET", "/api/admin/services"),
  createService: (body: ServiceData) =>
    call<{ service: AdminService }>("POST", "/api/admin/services", body),
  updateService: (id: string, body: ServiceUpdate) =>
    call<{ service: AdminService }>("PATCH", `/api/admin/services/${encodeURIComponent(id)}`, body),
  bookingDays: () => call<{ days: string[] }>("GET", "/api/booking/days"),
  bookingTimes: (date: string, serviceIds: readonly string[]) =>
    call<{ times: string[] }>(
      "GET",
      `/api/booking/times?${new URLSearchParams({ date, services: serviceIds.join(",") })}`,
    ),
  book: (body: BookingRequest) => call<BookingResult>("POST", "/api/appointments", body),
  myAppointments: () => call<MyAppointments>("GET", "/api/appointments"),
  agenda: (from: string, to: string, withCancelled: boolean) =>
    call<Agenda>(
      "GET",
      `/api/admin/agenda?${new URLSearchParams({ from, to, ...(withCancelled ? { cancelled: "1" } : {}) })}`,
    ),
  markAppointment: (id: string, status: MarkedStatus) =>
    call<AgendaChange>("PATCH", `/api/admin/appointments/${encodeURIComponent(id)}/status`, {
      status,
    }),
  cancelAppointment: (id: string) =>
    call<AppointmentChange>("POST", `/api/appointments/${encodeURIComponent(id)}/cancel`),
  rescheduleTimes: (id: string, date: string) =>
    call<{ times: string[] }>(
      "GET",
      `/api/appointments/${encodeURIComponent(id)}/times?${new URLSearchParams({ date })}`,
    ),
  rescheduleAppointment: (id: string, body: { date: string; time: string }) =>
    call<AppointmentChange>("PATCH", `/api/appointments/${encodeURIComponent(id)}`, body),
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
    case "busy":
      return "Hay muchas reservas en este momento. Inténtalo de nuevo en unos segundos.";
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
