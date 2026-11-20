import { describe, expect, it } from "vitest";
import { formatDuration, formatPrice, selectionSummary, summarize } from "../src/services.js";

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
