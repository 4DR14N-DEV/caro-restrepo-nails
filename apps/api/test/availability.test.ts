import { describe, expect, it } from "vitest";
import {
  availableTimes,
  bookingWindow,
  openIntervals,
  type DaySchedule,
} from "../src/booking/availability.js";
import { bogotaInstant } from "../src/booking/dates.js";

const rules = { bufferMinutes: 10, slotStepMinutes: 30 };
const MONDAY = "2026-11-23";
const at = (time: string, date = MONDAY) => bogotaInstant(date, time);

function day(values: Partial<DaySchedule> = {}): DaySchedule {
  return {
    date: MONDAY,
    hours: { opensAt: "09:00:00", closesAt: "19:00:00" },
    exceptions: [],
    appointments: [],
    ...values,
  };
}

// Horas cada media hora entre dos extremos, incluidos: ("09:00", "10:00") → 09:00, 09:30, 10:00.
function halfHours(from: string, to: string): string[] {
  const times: string[] = [];
  for (let t = at(from).getTime(); t <= at(to).getTime(); t += 30 * 60_000) {
    const instant = new Date(t - 5 * 60 * 60_000);
    times.push(instant.toISOString().slice(11, 16));
  }
  return times;
}

describe("bookingWindow", () => {
  const settings = { bookingMinDays: 2, bookingMaxMonths: 1 };

  it("del ejemplo de los requisitos: el 18 de diciembre se reserva del 18 de noviembre al 16 de diciembre", () => {
    expect(bookingWindow("2026-11-18", settings).last).toBe("2026-12-18");
    expect(bookingWindow("2026-12-16", settings).first).toBe("2026-12-18");
    expect(bookingWindow("2026-12-17", settings).first).toBe("2026-12-19");
  });

  it("hoy, 20 de noviembre, se puede reservar del 22 de noviembre al 20 de diciembre", () => {
    expect(bookingWindow("2026-11-20", settings)).toEqual({
      first: "2026-11-22",
      last: "2026-12-20",
    });
  });
});

describe("availableTimes", () => {
  it("ofrece cada 30 minutos desde la apertura mientras el bloque entre antes del cierre", () => {
    expect(availableTimes(day(), 60, rules)).toEqual(halfHours("09:00", "18:00"));
    expect(availableTimes(day(), 90, rules).at(-1)).toBe("17:30");
  });

  it("no exige el margen al cierre", () => {
    // 18:00 + 60 min = 19:00, justo al cierre; el margen quedaría después.
    expect(availableTimes(day(), 60, rules)).toContain("18:00");
  });

  it("no choca con otra cita ni con su margen, y ofrece la hora justo después (fin + margen)", () => {
    const booked = day({
      appointments: [{ startAt: at("10:00"), occupiedUntil: at("11:10") }],
    });
    const times = availableTimes(booked, 60, rules);

    // 9:00 terminaría a las 10:00 y su margen llegaría a las 10:10: choca.
    expect(times).not.toContain("09:00");
    expect(times).not.toContain("10:30");
    expect(times).toContain("11:10");
    expect(times).toContain("11:30");
    expect(times[0]).toBe("11:10");
  });

  it("el margen de la cita nueva tampoco puede chocar con la siguiente", () => {
    const booked = day({
      appointments: [{ startAt: at("11:10"), occupiedUntil: at("12:10") }],
    });
    const times = availableTimes(booked, 60, rules);

    // 10:00 + 60 min = 11:00, + 10 de margen = 11:10: entra justo.
    expect(times).toContain("10:00");
    expect(times).not.toContain("10:30");
  });

  it("respeta los descansos sin exigir el margen antes de ellos", () => {
    const withBreak = day({
      exceptions: [{ kind: "break", startsAt: at("13:00"), endsAt: at("14:00") }],
    });
    const times = availableTimes(withBreak, 60, rules);

    expect(times).toContain("12:00");
    expect(times).not.toContain("12:30");
    expect(times).not.toContain("13:00");
    expect(times).not.toContain("13:30");
    expect(times).toContain("14:00");
  });

  it("un bloqueo de todo el día no deja horas", () => {
    const blocked = day({
      exceptions: [{ kind: "block", startsAt: at("00:00"), endsAt: at("00:00", "2026-11-24") }],
    });
    expect(availableTimes(blocked, 30, rules)).toEqual([]);
  });

  it("una apertura extra suma horas antes de la apertura habitual", () => {
    const early = day({
      exceptions: [{ kind: "extra_open", startsAt: at("08:00"), endsAt: at("09:00") }],
    });
    expect(availableTimes(early, 60, rules).slice(0, 3)).toEqual(["08:00", "08:30", "09:00"]);
  });

  it("domingos y festivos no ofrecen horas, salvo una apertura extra", () => {
    const sunday = "2026-11-22";
    const holiday = "2026-12-08";
    expect(availableTimes(day({ date: sunday }), 30, rules)).toEqual([]);
    expect(availableTimes(day({ date: holiday }), 30, rules)).toEqual([]);

    const opened = day({
      date: sunday,
      exceptions: [
        { kind: "extra_open", startsAt: at("10:00", sunday), endsAt: at("11:00", sunday) },
      ],
    });
    expect(availableTimes(opened, 30, rules)).toEqual(["10:00", "10:30"]);
  });

  it("sin horario base para ese día no ofrece horas", () => {
    expect(availableTimes(day({ hours: undefined }), 30, rules)).toEqual([]);
  });
});

describe("openIntervals", () => {
  it("solo cuenta la parte de una excepción que cae en ese día", () => {
    const spanning = day({
      exceptions: [
        // Apertura extra cargada desde el día anterior: solo cuenta desde la medianoche.
        { kind: "extra_open", startsAt: at("20:00", "2026-11-22"), endsAt: at("08:00") },
      ],
    });
    expect(openIntervals(spanning)).toEqual([
      { start: at("00:00"), end: at("08:00") },
      { start: at("09:00"), end: at("19:00") },
    ]);
  });
});
