// Fechas del calendario de Bogotá como texto "AAAA-MM-DD" y horas como "HH:MM".
// Colombia no tiene horario de verano: Bogotá es siempre UTC−5, así que un desfase fijo
// convierte entre la hora de Bogotá y un instante.
const BOGOTA_OFFSET = "-05:00";
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

const midnightUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const dateOf = (instant: Date) => instant.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const instant = midnightUtc(date);
  instant.setUTCDate(instant.getUTCDate() + days);
  return dateOf(instant);
}

// Meses de calendario. Si el día no existe en el mes de llegada (31 de enero + 1 mes),
// queda el último día de ese mes.
export function addMonths(date: string, months: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return dateOf(new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))));
}

// Día de la semana ISO: 1 = lunes … 7 = domingo.
export function isoWeekday(date: string): number {
  return midnightUtc(date).getUTCDay() || 7;
}

export function bogotaDate(instant: Date): string {
  return dateOf(new Date(instant.getTime() - BOGOTA_OFFSET_MS));
}

export function bogotaTime(instant: Date): string {
  return new Date(instant.getTime() - BOGOTA_OFFSET_MS).toISOString().slice(11, 16);
}

// Instante de una fecha y hora de Bogotá. Acepta "HH:MM" y "HH:MM:SS" (columnas `time`).
export function bogotaInstant(date: string, time: string): Date {
  return new Date(`${date}T${time.slice(0, 5)}:00${BOGOTA_OFFSET}`);
}
