// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterForm } from "../src/components/RegisterForm";

const user = { id: "u1", name: "Ana María", phone: "+573001234567", role: "client" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("RegisterForm: a dónde vuelve", () => {
  it("con next interno, al crear la cuenta vuelve a esa página", async () => {
    window.history.replaceState(null, "", "/registro?next=%2Freservar");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user }), { status: 201 }))),
    );
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    render(<RegisterForm />);

    await userEvent.type(screen.getByLabelText("Nombre"), "Ana María");
    await userEvent.type(screen.getByLabelText("Celular"), "3001234567");
    await userEvent.type(screen.getByLabelText("Contraseña"), "clave-segura");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(assign).toHaveBeenCalledWith("/reservar");
  });
});

describe("RegisterForm: aceptar la política", () => {
  it("sin aceptar, el aviso queda asociado a la casilla para los lectores de pantalla", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<RegisterForm />);

    await userEvent.type(screen.getByLabelText("Nombre"), "Ana María");
    await userEvent.type(screen.getByLabelText("Celular"), "3001234567");
    await userEvent.type(screen.getByLabelText("Contraseña"), "clave-segura");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("aria-invalid")).toBe("true");
    const describedBy = checkbox.getAttribute("aria-describedby");
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBe(
      "Debes aceptar la política de tratamiento de datos.",
    );
  });
});
