import { describe, expect, it } from "vitest";
import {
  adminCancelMessage,
  bookingMessage,
  reminderMessage,
  cancelMessage,
  rescheduleMessage,
  formatDay,
  formatDayShort,
  formatTime,
  isCalendarDate,
  serviceIdsSchema,
  whatsappLink,
} from "../src/booking.js";

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

describe("formatos de día y hora", () => {
  it("escribe el día completo y corto en español", () => {
    expect(formatDay("2026-11-23")).toBe("lunes 23 de noviembre");
    expect(formatDay("2026-12-05")).toBe("sábado 5 de diciembre");
    expect(formatDayShort("2026-11-23")).toBe("lun 23 nov");
  });

  it("escribe la hora con a. m. y p. m.", () => {
    expect(formatTime("09:00")).toBe("9:00 a. m.");
    expect(formatTime("11:40")).toBe("11:40 a. m.");
    expect(formatTime("12:00")).toBe("12:00 p. m.");
    expect(formatTime("14:30")).toBe("2:30 p. m.");
  });
});

describe("mensaje de WhatsApp para Caro", () => {
  it("sigue el texto acordado con uno, dos o tres servicios", () => {
    const base = { name: "Ana María", date: "2026-11-23", time: "10:00" };
    expect(bookingMessage({ ...base, services: ["Retiro"] })).toBe(
      "Hola Caro, soy Ana María. Reservé Retiro el lunes 23 de noviembre a las 10:00 a. m.",
    );
    expect(bookingMessage({ ...base, services: ["Semipermanente manos", "Retiro"] })).toBe(
      "Hola Caro, soy Ana María. Reservé Semipermanente manos y Retiro el lunes 23 de noviembre a las 10:00 a. m.",
    );
    expect(bookingMessage({ ...base, services: ["A", "B", "C"] })).toContain("Reservé A, B y C el");
  });

  it("dice «a la» con la una", () => {
    expect(
      bookingMessage({ name: "Ana", services: ["Retiro"], date: "2026-11-23", time: "13:00" }),
    ).toBe("Hola Caro, soy Ana. Reservé Retiro el lunes 23 de noviembre a la 1:00 p. m.");
  });

  it("arma el enlace wa.me con el número sin + y el texto codificado", () => {
    expect(whatsappLink("+573007445676", "Hola Caro, soy Ana.")).toBe(
      "https://wa.me/573007445676?text=Hola%20Caro%2C%20soy%20Ana.",
    );
  });
});

describe("mensajes de WhatsApp al cancelar y reprogramar", () => {
  it("avisa la cancelación con los servicios, el día y la hora", () => {
    expect(
      cancelMessage({
        name: "Ana María",
        services: ["Retiro", "Semipermanente manos"],
        date: "2026-11-23",
        time: "10:00",
      }),
    ).toBe(
      "Hola Caro, soy Ana María. Cancelé mi cita de Retiro y Semipermanente manos del lunes 23 de noviembre a las 10:00 a. m.",
    );
  });

  it("avisa el cambio con el día y la hora de antes y los nuevos", () => {
    expect(
      rescheduleMessage({
        name: "Ana",
        services: ["Retiro"],
        from: { date: "2026-11-23", time: "10:00" },
        to: { date: "2026-11-24", time: "13:00" },
      }),
    ).toBe(
      "Hola Caro, soy Ana. Moví mi cita de Retiro del lunes 23 de noviembre a las 10:00 a. m. al martes 24 de noviembre a la 1:00 p. m.",
    );
  });
});

describe("mensajes de Caro a la clienta", () => {
  const appointment = {
    clientName: "Ana María",
    services: ["Retiro", "Semipermanente manos"],
    date: "2026-11-23",
    time: "10:00",
  };

  it("avisa que Caro canceló la cita", () => {
    expect(adminCancelMessage(appointment)).toBe(
      "Hola Ana María, soy Caro. Tuve que cancelar tu cita de Retiro y Semipermanente manos del lunes 23 de noviembre a las 10:00 a. m. Escríbeme para buscar otro horario.",
    );
  });

  it("recuerda la cita", () => {
    expect(reminderMessage({ ...appointment, time: "13:00" })).toBe(
      "Hola Ana María, te recuerdo tu cita de Retiro y Semipermanente manos el lunes 23 de noviembre a la 1:00 p. m. ¡Te espero!",
    );
  });
});
