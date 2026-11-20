// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceCatalog } from "../src/components/ServiceCatalog";

const catalog = [
  { id: "s1", name: "Semipermanente manos", priceCop: 40000, durationMinutes: 60 },
  { id: "s2", name: "Retoque", priceCop: 60000, durationMinutes: 90 },
  { id: "s3", name: "Retiro", priceCop: 15000, durationMinutes: 30 },
];

function mockServices(...responses: (() => Promise<Response>)[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockImplementationOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = (services: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify({ services }), { status: 200 }));

const summary = () => screen.getByRole("status");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ServiceCatalog", () => {
  it("muestra cada servicio con su precio y duración", async () => {
    const fetchMock = mockServices(ok(catalog));
    render(<ServiceCatalog />);

    const retoque = await screen.findByRole("checkbox", { name: /Retoque/ });
    expect(retoque.closest("label")?.textContent).toContain("$60.000");
    expect(retoque.closest("label")?.textContent).toContain("1 h 30 min");
    expect(screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual(
      [
        expect.stringContaining("Semipermanente manos"),
        expect.stringContaining("Retoque"),
        expect.stringContaining("Retiro"),
      ],
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/services",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("al elegir servicios muestra el total de tiempo y precio", async () => {
    mockServices(ok(catalog));
    render(<ServiceCatalog />);

    await userEvent.click(await screen.findByRole("checkbox", { name: /Semipermanente manos/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Retoque/ }));

    expect(summary().textContent).toBe("2 servicios · 2 h 30 min · $100.000");

    await userEvent.click(screen.getByRole("checkbox", { name: /Semipermanente manos/ }));
    expect(summary().textContent).toBe("1 servicio · 1 h 30 min · $60.000");
  });

  it("sin servicios elegidos invita a elegir", async () => {
    mockServices(ok(catalog));
    render(<ServiceCatalog />);

    await screen.findAllByRole("checkbox");
    expect(summary().textContent).toBe("Elige uno o varios servicios para ver el total.");
  });

  it("si no hay servicios activos lo dice", async () => {
    mockServices(ok([]));
    render(<ServiceCatalog />);

    expect(await screen.findByText("Pronto publicaremos los servicios.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("si falla la carga avisa y permite reintentar", async () => {
    mockServices(() => Promise.reject(new TypeError("Failed to fetch")), ok(catalog));
    render(<ServiceCatalog />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos cargar los servicios. Revisa tu internet e inténtalo de nuevo.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("checkbox", { name: /Retiro/ })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
