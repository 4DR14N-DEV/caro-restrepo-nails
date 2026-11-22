import { describe, expect, it } from "vitest";
import { appointmentNoticePayload } from "../src/push.js";

describe("appointmentNoticePayload", () => {
  it("nueva cita: nombre, servicios, día y hora; abre la agenda en ese día", () => {
    expect(
      appointmentNoticePayload({
        kind: "booked",
        clientName: "Ana María",
        services: ["Semipermanente", "Press on"],
        date: "2026-11-30",
        time: "10:00",
      }),
    ).toEqual({
      title: "Nueva cita",
      body: "Ana María, Semipermanente y Press on, lunes 30 de noviembre a las 10:00 a. m.",
      url: "/admin/agenda?dia=2026-11-30",
    });
  });

  it("cita cancelada", () => {
    expect(
      appointmentNoticePayload({
        kind: "cancelled",
        clientName: "Ana María",
        services: ["Acrílico"],
        date: "2026-12-01",
        time: "13:30",
      }),
    ).toEqual({
      title: "Cita cancelada",
      body: "Ana María, Acrílico, martes 1 de diciembre a la 1:30 p. m.",
      url: "/admin/agenda?dia=2026-12-01",
    });
  });

  it("cita reprogramada: del día anterior al nuevo; abre el día nuevo", () => {
    expect(
      appointmentNoticePayload({
        kind: "rescheduled",
        clientName: "Ana María",
        services: ["Semipermanente"],
        from: { date: "2026-11-30", time: "10:00" },
        date: "2026-12-02",
        time: "15:00",
      }),
    ).toEqual({
      title: "Cita reprogramada",
      body: "Ana María, Semipermanente, del lunes 30 de noviembre a las 10:00 a. m. al miércoles 2 de diciembre a las 3:00 p. m.",
      url: "/admin/agenda?dia=2026-12-02",
    });
  });
});
