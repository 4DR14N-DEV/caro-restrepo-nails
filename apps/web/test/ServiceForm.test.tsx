// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceForm } from "../src/components/ServiceForm";

const saved = {
  ok: true as const,
  data: { service: { id: "s1", name: "Manicure", priceCop: 1, durationMinutes: 5, active: true } },
};

async function submit(price: string, duration: string) {
  const save = vi.fn().mockResolvedValue(saved);
  render(<ServiceForm save={save} onSaved={() => {}} onCancel={() => {}} />);
  await userEvent.type(screen.getByLabelText("Nombre"), "Manicure");
  if (price) await userEvent.type(screen.getByLabelText("Precio (pesos)"), price);
  if (duration) await userEvent.type(screen.getByLabelText("Duración (minutos)"), duration);
  await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
  return save;
}

afterEach(() => {
  cleanup();
});

describe("ServiceForm: números", () => {
  it.each([
    ["25000", 25000],
    ["25.000", 25000],
    ["$25.000", 25000],
    ["$ 25000", 25000],
    ["1.500.000", 1500000],
  ])("acepta el precio %s como %d pesos", async (price, priceCop) => {
    const save = await submit(price, "45");
    expect(save).toHaveBeenCalledWith({ name: "Manicure", priceCop, durationMinutes: 45 });
  });

  // Regresión: se quitaban todos los puntos y "25.5" se guardaba como 255.
  it.each(["25.5", "2.50", "25,5"])("rechaza el precio %s en vez de cambiarlo", async (price) => {
    const save = await submit(price, "45");
    expect(save).not.toHaveBeenCalled();
    expect(
      screen.getByText("El precio debe ser un número entero entre 0 y 2.000.000."),
    ).toBeTruthy();
  });

  it("rechaza una duración con decimales en vez de cambiarla", async () => {
    const save = await submit("25000", "1.5");
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("La duración debe estar entre 5 y 480 minutos.")).toBeTruthy();
  });

  it("un precio vacío no se toma como 0", async () => {
    const save = await submit("", "45");
    expect(save).not.toHaveBeenCalled();
    expect(
      screen.getByText("El precio debe ser un número entero entre 0 y 2.000.000."),
    ).toBeTruthy();
  });
});
