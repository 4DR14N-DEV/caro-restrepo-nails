import { describe, expect, it } from "vitest";
import { colombianHolidays, isClosedDay } from "../src/booking/holidays.js";

// Listas oficiales de festivos de Colombia.
describe("colombianHolidays", () => {
  it("2026: fijos, trasladados al lunes y los de la Pascua (5 de abril)", () => {
    expect(colombianHolidays(2026)).toEqual([
      "2026-01-01", // Año Nuevo
      "2026-01-12", // Reyes Magos (6 de enero, al lunes)
      "2026-03-23", // San José (19 de marzo, al lunes)
      "2026-04-02", // Jueves Santo
      "2026-04-03", // Viernes Santo
      "2026-05-01", // Día del Trabajo
      "2026-05-18", // Ascensión
      "2026-06-08", // Corpus Christi
      "2026-06-15", // Sagrado Corazón
      "2026-06-29", // San Pedro y San Pablo (ya es lunes)
      "2026-07-20", // Independencia
      "2026-08-07", // Batalla de Boyacá
      "2026-08-17", // Asunción (15 de agosto, al lunes)
      "2026-10-12", // Día de la Raza (ya es lunes)
      "2026-11-02", // Todos los Santos (1 de noviembre, al lunes)
      "2026-11-16", // Independencia de Cartagena (11 de noviembre, al lunes)
      "2026-12-08", // Inmaculada Concepción
      "2026-12-25", // Navidad
    ]);
  });

  it("2025: dos festivos que caen el mismo lunes cuentan como un día", () => {
    // Sagrado Corazón y San Pedro (29 de junio, domingo) caen ambos el 30 de junio.
    expect(colombianHolidays(2025)).toEqual([
      "2025-01-01",
      "2025-01-06",
      "2025-03-24",
      "2025-04-17",
      "2025-04-18",
      "2025-05-01",
      "2025-06-02",
      "2025-06-23",
      "2025-06-30",
      "2025-07-20",
      "2025-08-07",
      "2025-08-18",
      "2025-10-13",
      "2025-11-03",
      "2025-11-17",
      "2025-12-08",
      "2025-12-25",
    ]);
  });
});

describe("isClosedDay", () => {
  it("cierra domingos y festivos, y abre los demás días", () => {
    expect(isClosedDay("2026-11-22")).toBe(true); // domingo
    expect(isClosedDay("2026-12-08")).toBe(true); // martes festivo
    expect(isClosedDay("2026-11-16")).toBe(true); // lunes festivo
    expect(isClosedDay("2026-11-23")).toBe(false); // lunes
    expect(isClosedDay("2026-11-21")).toBe(false); // sábado
  });
});
