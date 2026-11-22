import { describe, expect, it } from "vitest";
import { newPasswordMessage } from "../src/clients.js";

describe("newPasswordMessage", () => {
  it("le dice a la clienta su clave nueva y dónde cambiarla", () => {
    expect(newPasswordMessage({ name: "Ana María", password: "k7m2q9rt4x" })).toBe(
      'Hola Ana María, soy Caro. Tu nueva contraseña es k7m2q9rt4x. Ingresa con tu celular y esta contraseña; puedes cambiarla en "Mis citas".',
    );
  });
});
