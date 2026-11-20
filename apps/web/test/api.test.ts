import { afterEach, describe, expect, it, vi } from "vitest";
import { api, formErrorMessage, logoutErrorMessage } from "../src/lib/api";
import { fieldErrors } from "../src/lib/forms";

function mockFetch(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), { status, headers }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("envía JSON y devuelve los datos cuando la respuesta es correcta", async () => {
    const fetchMock = mockFetch(200, { user: { id: "1", name: "Ana" } });

    const result = await api.login({ phone: "+573001234567", password: "x" });

    expect(result).toEqual({ ok: true, data: { user: { id: "1", name: "Ana" } } });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+573001234567", password: "x" }),
      credentials: "same-origin",
    });
  });

  it("devuelve el código de error, los campos y los segundos de espera", async () => {
    mockFetch(429, { error: "too_many_attempts" }, { "Retry-After": "120" });

    expect(await api.login({})).toEqual({
      ok: false,
      status: 429,
      error: "too_many_attempts",
      retryAfterSeconds: 120,
    });

    mockFetch(400, { error: "invalid_input", fields: { phone: "Mal" } });
    expect(await api.register({})).toEqual({
      ok: false,
      status: 400,
      error: "invalid_input",
      fields: { phone: "Mal" },
    });
  });

  it("acepta respuestas 204 sin cuerpo", async () => {
    mockFetch(204);
    expect(await api.logout()).toEqual({ ok: true, data: null });
  });

  it("convierte un fallo de red en el error `network`", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await api.me()).toEqual({ ok: false, status: 0, error: "network" });
  });

  it("responde `unknown` si el error no trae cuerpo JSON", async () => {
    mockFetch(502);
    expect(await api.me()).toEqual({ ok: false, status: 502, error: "unknown" });
  });
});

describe("formErrorMessage", () => {
  it("explica las credenciales incorrectas", () => {
    expect(formErrorMessage({ ok: false, status: 401, error: "invalid_credentials" })).toBe(
      "Celular o contraseña incorrectos.",
    );
  });

  it("redondea los minutos de espera hacia arriba y usa singular o plural", () => {
    const blocked = { ok: false as const, status: 429, error: "too_many_attempts" };
    expect(formErrorMessage({ ...blocked, retryAfterSeconds: 61 })).toBe(
      "Demasiados intentos. Vuelve a intentarlo en 2 minutos.",
    );
    expect(formErrorMessage({ ...blocked, retryAfterSeconds: 30 })).toBe(
      "Demasiados intentos. Vuelve a intentarlo en 1 minuto.",
    );
  });

  // El registro bloquea 1 hora y el ingreso 15 minutos: sin la cabecera no se adivina.
  it("sin la espera del servidor no inventa una duración", () => {
    expect(formErrorMessage({ ok: false, status: 429, error: "too_many_attempts" })).toBe(
      "Demasiados intentos. Vuelve a intentarlo más tarde.",
    );
  });

  it("muestra horas cuando la espera es de una hora o más", () => {
    const blocked = { ok: false as const, status: 429, error: "too_many_attempts" };
    expect(formErrorMessage({ ...blocked, retryAfterSeconds: 3600 })).toBe(
      "Demasiados intentos. Vuelve a intentarlo en 1 hora.",
    );
    expect(formErrorMessage({ ...blocked, retryAfterSeconds: 7200 })).toBe(
      "Demasiados intentos. Vuelve a intentarlo en 2 horas.",
    );
  });

  // Regresión: entre 3541 y 3599 segundos se redondeaba a "60 minutos".
  it("una espera que redondea a 60 minutos se muestra como 1 hora", () => {
    const blocked = { ok: false as const, status: 429, error: "too_many_attempts" };
    expect(formErrorMessage({ ...blocked, retryAfterSeconds: 3541 })).toBe(
      "Demasiados intentos. Vuelve a intentarlo en 1 hora.",
    );
    expect(formErrorMessage({ ...blocked, retryAfterSeconds: 3540 })).toBe(
      "Demasiados intentos. Vuelve a intentarlo en 59 minutos.",
    );
  });

  it("tiene mensajes para la red y para errores desconocidos", () => {
    expect(formErrorMessage({ ok: false, status: 0, error: "network" })).toBe(
      "No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo.",
    );
    expect(formErrorMessage({ ok: false, status: 500, error: "internal_error" })).toBe(
      "Algo salió mal. Inténtalo de nuevo en un momento.",
    );
  });
});

describe("logoutErrorMessage", () => {
  it("avisa que la sesión sigue abierta si la salida falla", () => {
    expect(logoutErrorMessage).toBe("No pudimos cerrar tu sesión. Inténtalo de nuevo.");
  });
});

describe("fieldErrors", () => {
  it("toma el primer mensaje de cada campo", () => {
    expect(
      fieldErrors([
        { path: ["phone"], message: "Primero" },
        { path: ["phone"], message: "Segundo" },
        { path: ["password"], message: "Clave" },
        { path: [], message: "General" },
      ]),
    ).toEqual({ phone: "Primero", password: "Clave", form: "General" });
  });
});
