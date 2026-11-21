import { describe, expect, it } from "vitest";
import {
  addDays,
  bogotaDate,
  isoWeekday,
  monthGrid,
  mondayOf,
  shiftMonth,
  weekDays,
} from "../src/calendar.js";

describe("calendario", () => {
  it("suma días, numera la semana ISO y da la fecha de Bogotá", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(isoWeekday("2026-11-23")).toBe(1);
    expect(isoWeekday("2026-11-29")).toBe(7);
    // 21 de noviembre a las 3:00 UTC todavía es el 20 en Bogotá.
    expect(bogotaDate(new Date("2026-11-21T03:00:00Z"))).toBe("2026-11-20");
  });

  it("la semana va de lunes a sábado", () => {
    expect(mondayOf("2026-11-26")).toBe("2026-11-23");
    expect(mondayOf("2026-11-29")).toBe("2026-11-23"); // domingo
    expect(weekDays("2026-11-26")).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
    ]);
  });

  it("el mes ocupa semanas completas de lunes a domingo", () => {
    const grid = monthGrid("2026-11-15");
    // Noviembre de 2026 empieza en domingo: la grilla arranca el lunes 26 de octubre.
    expect(grid.first).toBe("2026-10-26");
    expect(grid.last).toBe("2026-12-06");
    expect(grid.weeks).toHaveLength(6);
    expect(grid.weeks[0]).toHaveLength(7);
    expect(grid.weeks.flat()).toContain("2026-11-30");
  });

  it("pasa al mes anterior o siguiente desde cualquier día", () => {
    expect(shiftMonth("2026-11-23", 1)).toBe("2026-12-01");
    expect(shiftMonth("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-01");
  });
});
