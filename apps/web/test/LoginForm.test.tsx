// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "../src/components/LoginForm";

const user = { id: "u1", name: "Ana María", phone: "+573001234567", role: "client" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

async function logIn(path: string) {
  window.history.replaceState(null, "", path);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))),
  );
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  render(<LoginForm />);
  await userEvent.type(screen.getByLabelText("Celular"), "3001234567");
  await userEvent.type(screen.getByLabelText("Contraseña"), "clave-segura");
  await userEvent.click(screen.getByRole("button", { name: "Ingresar" }));
  return assign;
}

describe("LoginForm: a dónde vuelve", () => {
  it("sin next vuelve al inicio", async () => {
    expect(await logIn("/ingreso")).toHaveBeenCalledWith("/");
  });

  it("con next interno vuelve a esa página", async () => {
    expect(await logIn("/ingreso?next=%2Freservar")).toHaveBeenCalledWith("/reservar");
  });

  it("con next a otro sitio vuelve al inicio", async () => {
    expect(await logIn("/ingreso?next=%2F%2Fotro-sitio.com")).toHaveBeenCalledWith("/");
  });
});
