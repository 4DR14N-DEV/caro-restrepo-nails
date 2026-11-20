import { describe, expect, it } from "vitest";
import { loginSchema, passwordSchema, phoneSchema, registerSchema } from "../src/index.js";

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message;
}

describe("phoneSchema", () => {
  it("convierte un celular de 10 dígitos al formato +57", () => {
    expect(phoneSchema.parse("3001234567")).toBe("+573001234567");
  });

  it("acepta espacios, guiones, paréntesis y el prefijo del país", () => {
    expect(phoneSchema.parse(" 300 123-4567 ")).toBe("+573001234567");
    expect(phoneSchema.parse("(300) 1234567")).toBe("+573001234567");
    expect(phoneSchema.parse("+57 300 123 4567")).toBe("+573001234567");
    expect(phoneSchema.parse("573001234567")).toBe("+573001234567");
  });

  it.each(["300123456", "30012345678", "6011234567", "300123456a", ""])(
    "rechaza %j con un mensaje en español",
    (value) => {
      const result = phoneSchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(firstMessage(result)).toBe("Escribe un celular de 10 dígitos que empiece por 3.");
    },
  );
});

describe("passwordSchema", () => {
  it("acepta 8 caracteres sin exigir mayúsculas ni símbolos", () => {
    expect(passwordSchema.parse("abcdefgh")).toBe("abcdefgh");
  });

  it("no recorta los espacios: son parte de la contraseña", () => {
    expect(passwordSchema.parse(" abc def ")).toBe(" abc def ");
  });

  it("rechaza menos de 8 caracteres", () => {
    const result = passwordSchema.safeParse("abcdefg");
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe("La contraseña debe tener al menos 8 caracteres.");
  });

  it("rechaza más de 128 caracteres", () => {
    const result = passwordSchema.safeParse("a".repeat(129));
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe("La contraseña puede tener máximo 128 caracteres.");
  });
});

describe("registerSchema", () => {
  const valid = {
    name: "  Ana María  ",
    phone: "300 123 4567",
    password: "secreta123",
    consent: true,
  };

  it("normaliza nombre y teléfono", () => {
    expect(registerSchema.parse(valid)).toEqual({
      name: "Ana María",
      phone: "+573001234567",
      password: "secreta123",
      consent: true,
    });
  });

  it("exige aceptar el tratamiento de datos", () => {
    const result = registerSchema.safeParse({ ...valid, consent: false });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe("Debes aceptar la política de tratamiento de datos.");
  });

  it("exige un nombre de al menos 2 caracteres", () => {
    const result = registerSchema.safeParse({ ...valid, name: " a " });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe("Escribe tu nombre.");
  });

  it("rechaza nombres de más de 80 caracteres", () => {
    const result = registerSchema.safeParse({ ...valid, name: "a".repeat(81) });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe("El nombre puede tener máximo 80 caracteres.");
  });
});

describe("loginSchema", () => {
  it("normaliza el teléfono y no aplica el mínimo de 8 a la contraseña", () => {
    expect(loginSchema.parse({ phone: "3001234567", password: "x" })).toEqual({
      phone: "+573001234567",
      password: "x",
    });
  });

  it("exige escribir la contraseña", () => {
    const result = loginSchema.safeParse({ phone: "3001234567", password: "" });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe("Escribe tu contraseña.");
  });
});
