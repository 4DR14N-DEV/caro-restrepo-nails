// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PushToggle } from "../src/components/PushToggle";
import type { PushBrowser, PushSupport } from "../src/lib/push";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const device = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  expirationTime: null,
  keys: { p256dh: "BNcRdre", auth: "tBHItJI" },
};

// Navegador falso: qué soporta, el permiso y la suscripción actual.
function fakeBrowser({
  support = "ready",
  permission = "default",
  subscribed = false,
  subscribeFails = false,
}: {
  support?: PushSupport;
  permission?: NotificationPermission;
  subscribed?: boolean;
  subscribeFails?: boolean;
} = {}) {
  const state = { permission, subscription: subscribed ? device : null };
  const browser: PushBrowser = {
    support: () => support,
    permission: () => state.permission,
    subscription: vi.fn(async () => state.subscription),
    subscribe: vi.fn(async () => {
      if (subscribeFails) {
        state.permission = "denied";
        throw new Error("permiso denegado");
      }
      state.permission = "granted";
      state.subscription = device;
      return device;
    }),
    unsubscribe: vi.fn(async () => {
      state.subscription = null;
    }),
  };
  return browser;
}

// Responde según la ruta; cada respuesta se puede cambiar por test.
function mockApi(routes: Partial<Record<string, Response>> = {}) {
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${path}`;
    const defaults: Record<string, Response> = {
      "GET /api/admin/push/key": json(200, { publicKey: "clave-publica" }),
      "PUT /api/admin/push/subscription": new Response(null, { status: 204 }),
      "POST /api/admin/push/subscription/delete": new Response(null, { status: 204 }),
    };
    const response = routes[key] ?? defaults[key];
    return Promise.resolve(response ? response.clone() : json(404, { error: "not_found" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof mockApi>, key: string) =>
  fetchMock.mock.calls.filter(([path, init]) => `${init?.method ?? "GET"} ${path}` === key);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PushToggle", () => {
  it("activa los avisos en este dispositivo y guarda la suscripción", async () => {
    const fetchMock = mockApi();
    const browser = fakeBrowser();
    render(<PushToggle browser={browser} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Activar avisos en este dispositivo" }),
    );

    expect(browser.subscribe).toHaveBeenCalledWith("clave-publica");
    const [saved] = calls(fetchMock, "PUT /api/admin/push/subscription");
    expect(JSON.parse(String(saved?.[1]?.body))).toEqual(device);
    expect(await screen.findByText("Los avisos están activos en este dispositivo.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desactivar avisos" })).toBeTruthy();
  });

  it("si ya estaban activos, lo muestra y vuelve a guardar la suscripción", async () => {
    const fetchMock = mockApi();
    render(<PushToggle browser={fakeBrowser({ permission: "granted", subscribed: true })} />);

    expect(await screen.findByText("Los avisos están activos en este dispositivo.")).toBeTruthy();
    expect(calls(fetchMock, "PUT /api/admin/push/subscription")).toHaveLength(1);
  });

  it("si al cargar no puede volver a guardarla, no dice que están activos", async () => {
    mockApi({ "PUT /api/admin/push/subscription": json(500, { error: "internal_error" }) });
    render(<PushToggle browser={fakeBrowser({ permission: "granted", subscribed: true })} />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos confirmar los avisos en este dispositivo. Actívalos otra vez.",
    );
    expect(screen.queryByText("Los avisos están activos en este dispositivo.")).toBeNull();
    expect(screen.getByRole("button", { name: "Activar avisos en este dispositivo" })).toBeTruthy();
  });

  it("revisa la suscripción con la clave actual del servidor", async () => {
    mockApi();
    const browser = fakeBrowser({ permission: "granted", subscribed: true });
    render(<PushToggle browser={browser} />);

    await screen.findByText("Los avisos están activos en este dispositivo.");
    expect(browser.subscription).toHaveBeenCalledWith("clave-publica");
  });

  it("desactivar borra la suscripción del servidor y del navegador", async () => {
    const fetchMock = mockApi();
    const browser = fakeBrowser({ permission: "granted", subscribed: true });
    render(<PushToggle browser={browser} />);

    await userEvent.click(await screen.findByRole("button", { name: "Desactivar avisos" }));

    const [deleted] = calls(fetchMock, "POST /api/admin/push/subscription/delete");
    expect(JSON.parse(String(deleted?.[1]?.body))).toEqual({ endpoint: device.endpoint });
    expect(browser.unsubscribe).toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "Activar avisos en este dispositivo" }),
    ).toBeTruthy();
  });

  it("si el servidor no puede borrarla, avisa y la deja activa en el navegador", async () => {
    mockApi({ "POST /api/admin/push/subscription/delete": json(500, { error: "internal_error" }) });
    const browser = fakeBrowser({ permission: "granted", subscribed: true });
    render(<PushToggle browser={browser} />);

    await userEvent.click(await screen.findByRole("button", { name: "Desactivar avisos" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos desactivar los avisos. Inténtalo de nuevo.",
    );
    expect(browser.unsubscribe).not.toHaveBeenCalled();
  });

  it("si el servidor no la guarda, avisa y deja el botón para intentar otra vez", async () => {
    mockApi({ "PUT /api/admin/push/subscription": json(500, { error: "internal_error" }) });
    render(<PushToggle browser={fakeBrowser()} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Activar avisos en este dispositivo" }),
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos activar los avisos. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("button", { name: "Activar avisos en este dispositivo" })).toBeTruthy();
  });

  it("si Caro no da permiso, explica cómo desbloquearlos", async () => {
    mockApi();
    render(<PushToggle browser={fakeBrowser({ subscribeFails: true })} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Activar avisos en este dispositivo" }),
    );

    expect(
      await screen.findByText(
        "Los avisos están bloqueados en este navegador. Permítelos en los ajustes del sitio para activarlos.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Activar avisos en este dispositivo" })).toBeNull();
  });

  it("con el permiso ya bloqueado no ofrece el botón", async () => {
    mockApi();
    render(<PushToggle browser={fakeBrowser({ permission: "denied" })} />);
    expect(
      await screen.findByText(
        "Los avisos están bloqueados en este navegador. Permítelos en los ajustes del sitio para activarlos.",
      ),
    ).toBeTruthy();
  });

  it("en iPhone sin instalar explica cómo agregarla a la pantalla de inicio", async () => {
    const fetchMock = mockApi();
    render(<PushToggle browser={fakeBrowser({ support: "ios-install" })} />);
    expect(
      await screen.findByText(
        'Para recibir avisos en iPhone (iOS 16.4 o más nuevo), abre esta página en Safari, toca Compartir y luego "Agregar a pantalla de inicio". Después ábrela desde ese ícono y activa los avisos.',
      ),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un navegador sin avisos push lo dice", async () => {
    mockApi();
    render(<PushToggle browser={fakeBrowser({ support: "unsupported" })} />);
    expect(await screen.findByText("Este navegador no puede recibir avisos.")).toBeTruthy();
  });

  it("sin claves en el servidor dice que no están configurados", async () => {
    mockApi({ "GET /api/admin/push/key": json(200, { publicKey: null }) });
    render(<PushToggle browser={fakeBrowser()} />);
    expect(await screen.findByText("Los avisos todavía no están configurados.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("si no puede consultar el servidor, avisa", async () => {
    mockApi({ "GET /api/admin/push/key": json(500, { error: "internal_error" }) });
    render(<PushToggle browser={fakeBrowser()} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos revisar los avisos. Recarga la página.",
    );
  });
});
