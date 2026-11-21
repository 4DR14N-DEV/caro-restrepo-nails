import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  bogotaDate,
  bogotaInstant,
  bogotaTime,
  isoWeekday,
} from "../src/booking/dates.js";

describe("fechas de Bogotá", () => {
  it("suma días y meses de calendario, con el último día si el mes es más corto", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addMonths("2026-11-20", 1)).toBe("2026-12-20");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
  });

  it("numera los días como ISO: lunes 1, domingo 7", () => {
    expect(isoWeekday("2026-11-23")).toBe(1);
    expect(isoWeekday("2026-11-22")).toBe(7);
  });

  it("convierte entre instantes y la hora de Bogotá (UTC−5)", () => {
    // 21 de noviembre a las 3:00 UTC es todavía el 20 en Bogotá, a las 22:00.
    const instant = new Date("2026-11-21T03:00:00Z");
    expect(bogotaDate(instant)).toBe("2026-11-20");
    expect(bogotaTime(instant)).toBe("22:00");
    expect(bogotaInstant("2026-11-20", "22:00").toISOString()).toBe("2026-11-21T03:00:00.000Z");
    expect(bogotaInstant("2026-11-23", "09:00:00").toISOString()).toBe("2026-11-23T14:00:00.000Z");
  });
});
