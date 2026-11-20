import { describe, expect, it } from "vitest";
import { isCalendarDate, serviceIdsSchema } from "../src/booking.js";

describe("isCalendarDate", () => {
  it("reconoce solo fechas reales del calendario", () => {
    expect(isCalendarDate("2026-11-20")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-11-20T00:00")).toBe(false);
    expect(isCalendarDate("20-11-2026")).toBe(false);
  });
});

describe("serviceIdsSchema", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const message = (ids: unknown) => serviceIdsSchema.safeParse(ids).error?.issues[0]?.message;

  it("acepta de uno a diez servicios distintos", () => {
    expect(serviceIdsSchema.safeParse([id(1)]).success).toBe(true);
    expect(serviceIdsSchema.safeParse([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id)).success).toBe(true);
  });

  it("rechaza ninguno, más de diez, repetidos o ids inválidos", () => {
    expect(message([])).toBe("Elige al menos un servicio.");
    expect(message([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(id))).toBe(
      "Elige como máximo 10 servicios.",
    );
    expect(message([id(1), id(1)])).toBe("No repitas servicios.");
    expect(message(["no-es-un-id"])).toBe("Elige al menos un servicio.");
  });
});
