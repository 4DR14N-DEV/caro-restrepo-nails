import { describe, expect, it } from "vitest";
import { describeException, formatRange } from "../src/agenda.js";

const base = { id: "e1", date: "2026-11-25", allDay: false, reason: null };

describe("formatRange", () => {
  it("junta a. m. o p. m. cuando las dos horas lo comparten", () => {
    expect(formatRange("13:00", "14:00")).toBe("1:00–2:00 p. m.");
    expect(formatRange("08:00", "09:00")).toBe("8:00–9:00 a. m.");
    expect(formatRange("11:30", "12:15")).toBe("11:30 a. m.–12:15 p. m.");
    expect(formatRange("16:00", "24:00")).toBe("4:00 p. m.–12:00 a. m.");
  });
});

describe("describeException", () => {
  it("nombra cada tipo con su franja", () => {
    expect(describeException({ ...base, kind: "break", from: "13:00", to: "14:00" })).toBe(
      "Descanso 1:00–2:00 p. m.",
    );
    expect(describeException({ ...base, kind: "block", from: "16:00", to: "17:30" })).toBe(
      "Bloqueado 4:00–5:30 p. m.",
    );
    expect(describeException({ ...base, kind: "extra_open", from: "08:00", to: "09:00" })).toBe(
      "Abre más temprano 8:00–9:00 a. m.",
    );
    expect(
      describeException({ ...base, kind: "block", from: "00:00", to: "24:00", allDay: true }),
    ).toBe("Día bloqueado");
  });
});
