import { describe, expect, it } from "vitest";
import {
  fitsHours,
  outsideHoursMessage,
  scheduleSettingsRequestSchema,
  type WeekdayHours,
} from "../src/schedule.js";

const week = (): WeekdayHours[] =>
  [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "19:00" }));

const rules = {
  bufferMinutes: 10,
  bookingMinDays: 2,
  bookingMaxMonths: 1,
  cancelMinHours: 2,
  rescheduleMinDays: 2,
};

const issues = (input: unknown) => {
  const result = scheduleSettingsRequestSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
};

// El horario de la semana con un día cambiado.
const withDay = (weekday: number, day: Partial<WeekdayHours>) => ({
  hours: week().map((d) => (d.weekday === weekday ? { ...d, ...day } : d)),
  rules,
});

describe("scheduleSettingsRequestSchema", () => {
  it("acepta el horario de lunes a sábado, un día cerrado y los límites", () => {
    const input = withDay(6, { opensAt: null, closesAt: null });
    input.hours[0] = { weekday: 1, opensAt: "08:00", closesAt: "21:00" }; // lunes
    expect(scheduleSettingsRequestSchema.safeParse(input).success).toBe(true);
    expect(
      scheduleSettingsRequestSchema.safeParse({
        hours: week(),
        rules: {
          bufferMinutes: 60,
          bookingMinDays: 14,
          bookingMaxMonths: 6,
          cancelMinHours: 48,
          rescheduleMinDays: 14,
        },
      }).success,
    ).toBe(true);
    expect(
      scheduleSettingsRequestSchema.safeParse({
        hours: week(),
        rules: {
          bufferMinutes: 0,
          bookingMinDays: 0,
          bookingMaxMonths: 1,
          cancelMinHours: 0,
          rescheduleMinDays: 0,
        },
      }).success,
    ).toBe(true);
  });

  it("horas desde las 8:00, hasta las 21:00, en pasos de 15 y la apertura antes del cierre", () => {
    expect(issues(withDay(1, { opensAt: "07:45" }))).toEqual({
      "hours.0.opensAt": "Se puede abrir desde las 8:00 a. m.",
    });
    expect(issues(withDay(2, { closesAt: "21:15" }))).toEqual({
      "hours.1.closesAt": "Se puede cerrar hasta las 9:00 p. m.",
    });
    expect(issues(withDay(3, { opensAt: "10:10" }))).toEqual({
      "hours.2.opensAt": "Elige una hora en múltiplos de 15 minutos.",
    });
    expect(issues(withDay(4, { opensAt: "12:00", closesAt: "12:00" }))).toEqual({
      "hours.3.closesAt": "La hora de cierre tiene que ser después de la de apertura.",
    });
    expect(issues(withDay(5, { closesAt: null }))).toEqual({
      "hours.4.closesAt": "Elige la hora de apertura y la de cierre, o marca el día como cerrado.",
    });
  });

  it("pide los seis días, de lunes a sábado, una vez cada uno", () => {
    const message = { hours: "Manda los seis días, de lunes a sábado." };
    expect(issues({ hours: week().slice(0, 5), rules })).toEqual(message);
    expect(issues(withDay(6, { weekday: 5 }))).toEqual(message);
    expect(issues(withDay(6, { weekday: 7 }))["hours"]).toBe(message.hours);
  });

  it("margen de 0 a 60 en pasos de 5; las reglas dentro de sus límites y enteras", () => {
    const rule = (patch: Partial<typeof rules>) =>
      issues({ hours: week(), rules: { ...rules, ...patch } });
    const margin = "El margen va de 0 a 60 minutos, en pasos de 5.";
    expect(rule({ bufferMinutes: 7 })).toEqual({ "rules.bufferMinutes": margin });
    expect(rule({ bufferMinutes: 65 })).toEqual({ "rules.bufferMinutes": margin });
    expect(rule({ bufferMinutes: -5 })).toEqual({ "rules.bufferMinutes": margin });
    expect(rule({ bookingMinDays: 15 })).toEqual({
      "rules.bookingMinDays": "La anticipación mínima va de 0 a 14 días.",
    });
    expect(rule({ bookingMaxMonths: 0 })).toEqual({
      "rules.bookingMaxMonths": "La anticipación máxima va de 1 a 6 meses.",
    });
    expect(rule({ cancelMinHours: 49 })).toEqual({
      "rules.cancelMinHours": "Cancelar va de 0 a 48 horas antes de la cita.",
    });
    expect(rule({ rescheduleMinDays: 1.5 })).toEqual({
      "rules.rescheduleMinDays": "Reprogramar va de 0 a 14 días antes de la cita.",
    });
  });

  it("rechaza campos de más", () => {
    expect(issues({ hours: week(), rules, slotStepMinutes: 15 })).toEqual({
      "": "No se aceptan estos campos: slotStepMinutes.",
    });
  });
});

describe("fitsHours", () => {
  const day = { weekday: 3, opensAt: "09:00", closesAt: "19:00" };

  it("la cita entra si empieza desde la apertura y termina hasta el cierre", () => {
    expect(fitsHours(day, "09:00", 60)).toBe(true);
    expect(fitsHours(day, "18:00", 60)).toBe(true);
    expect(fitsHours(day, "08:45", 60)).toBe(false);
    expect(fitsHours(day, "18:15", 60)).toBe(false);
  });

  it("un día cerrado o sin horario no tiene lugar", () => {
    expect(fitsHours({ weekday: 3, opensAt: null, closesAt: null }, "10:00", 30)).toBe(false);
    expect(fitsHours(undefined, "10:00", 30)).toBe(false);
  });
});

describe("outsideHoursMessage", () => {
  it("dice cuántas citas quedan fuera, en singular o plural", () => {
    expect(outsideHoursMessage(1)).toBe("Hay 1 cita agendada fuera del nuevo horario.");
    expect(outsideHoursMessage(3)).toBe("Hay 3 citas agendadas fuera del nuevo horario.");
  });
});
