import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatPrice,
  selectionSummary,
  serviceInputSchema,
  serviceUpdateSchema,
  summarize,
} from "../src/services.js";

describe("formatPrice", () => {
  it("escribe pesos con punto de miles y sin decimales", () => {
    expect(formatPrice(40000)).toBe("$40.000");
    expect(formatPrice(100000)).toBe("$100.000");
    expect(formatPrice(1500000)).toBe("$1.500.000");
    expect(formatPrice(900)).toBe("$900");
    expect(formatPrice(0)).toBe("$0");
  });
});

describe("formatDuration", () => {
  it("usa minutos por debajo de una hora", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(5)).toBe("5 min");
  });

  it("usa horas y minutos desde una hora", () => {
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(150)).toBe("2 h 30 min");
    expect(formatDuration(480)).toBe("8 h");
  });
});

describe("summarize", () => {
  it("suma la duración y el precio de los servicios elegidos", () => {
    expect(
      summarize([
        { priceCop: 40000, durationMinutes: 60 },
        { priceCop: 60000, durationMinutes: 90 },
      ]),
    ).toEqual({ count: 2, durationMinutes: 150, priceCop: 100000 });
  });

  it("sin servicios todo queda en cero", () => {
    expect(summarize([])).toEqual({ count: 0, durationMinutes: 0, priceCop: 0 });
  });
});

describe("selectionSummary", () => {
  it("resume la selección en una línea", () => {
    expect(selectionSummary({ count: 2, durationMinutes: 150, priceCop: 100000 })).toBe(
      "2 servicios · 2 h 30 min · $100.000",
    );
  });

  it("usa singular con un solo servicio", () => {
    expect(selectionSummary({ count: 1, durationMinutes: 30, priceCop: 15000 })).toBe(
      "1 servicio · 30 min · $15.000",
    );
  });
});

describe("serviceInputSchema", () => {
  const valid = { name: "  Retiro  ", priceCop: 15000, durationMinutes: 30 };

  it("acepta un servicio válido y limpia los espacios del nombre", () => {
    expect(serviceInputSchema.parse(valid)).toEqual({
      name: "Retiro",
      priceCop: 15000,
      durationMinutes: 30,
    });
  });

  it("acepta los límites exactos", () => {
    expect(
      serviceInputSchema.safeParse({ ...valid, name: "Ab", priceCop: 0, durationMinutes: 5 })
        .success,
    ).toBe(true);
    expect(
      serviceInputSchema.safeParse({
        name: "a".repeat(60),
        priceCop: 2000000,
        durationMinutes: 480,
      }).success,
    ).toBe(true);
  });

  it.each([
    [{ name: "A" }, "name", "El nombre debe tener entre 2 y 60 caracteres."],
    [{ name: "a".repeat(61) }, "name", "El nombre debe tener entre 2 y 60 caracteres."],
    [{ priceCop: -1 }, "priceCop", "El precio debe ser un número entero entre 0 y 2.000.000."],
    [{ priceCop: 2000001 }, "priceCop", "El precio debe ser un número entero entre 0 y 2.000.000."],
    [{ priceCop: 15000.5 }, "priceCop", "El precio debe ser un número entero entre 0 y 2.000.000."],
    [{ durationMinutes: 0 }, "durationMinutes", "La duración debe estar entre 5 y 480 minutos."],
    [{ durationMinutes: 485 }, "durationMinutes", "La duración debe estar entre 5 y 480 minutos."],
    [{ durationMinutes: 32 }, "durationMinutes", "La duración debe ser múltiplo de 5 minutos."],
  ])("rechaza %o con un mensaje para el formulario", (change, field, message) => {
    const result = serviceInputSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: [field], message });
  });

  it("rechaza textos donde van números", () => {
    expect(serviceInputSchema.safeParse({ ...valid, priceCop: "15000" }).success).toBe(false);
  });
});

describe("serviceUpdateSchema", () => {
  it("acepta cambiar solo algunos campos, incluido activar o desactivar", () => {
    expect(serviceUpdateSchema.parse({ active: false })).toEqual({ active: false });
    expect(serviceUpdateSchema.parse({ priceCop: 45000 })).toEqual({ priceCop: 45000 });
  });

  it("aplica las mismas reglas que al crear", () => {
    expect(serviceUpdateSchema.safeParse({ durationMinutes: 32 }).success).toBe(false);
  });

  it("rechaza un cambio vacío", () => {
    const result = serviceUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("No hay cambios para guardar.");
  });
});
