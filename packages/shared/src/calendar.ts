// Fechas del calendario como texto "AAAA-MM-DD", compartidas por la API y la web.
// Colombia no tiene horario de verano: Bogotá es siempre UTC−5.
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

const midnightUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const dateOf = (instant: Date) => instant.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const instant = midnightUtc(date);
  instant.setUTCDate(instant.getUTCDate() + days);
  return dateOf(instant);
}

// Día de la semana ISO: 1 = lunes … 7 = domingo.
export function isoWeekday(date: string): number {
  return midnightUtc(date).getUTCDay() || 7;
}

// La fecha de Bogotá de un instante (por ejemplo, hoy: `bogotaDate(new Date())`).
export function bogotaDate(instant: Date): string {
  return dateOf(new Date(instant.getTime() - BOGOTA_OFFSET_MS));
}

export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

// La semana de trabajo de una fecha: de lunes a sábado.
export function weekDays(date: string): string[] {
  const monday = mondayOf(date);
  return [0, 1, 2, 3, 4, 5].map((offset) => addDays(monday, offset));
}

// El mes de una fecha en semanas completas de lunes a domingo, para el calendario.
export function monthGrid(date: string): { first: string; last: string; weeks: string[][] } {
  const firstOfMonth = `${date.slice(0, 7)}-01`;
  const [year = 0, month = 1] = date.split("-").map(Number);
  const lastOfMonth = dateOf(new Date(Date.UTC(year, month, 0)));
  const first = mondayOf(firstOfMonth);
  const last = addDays(mondayOf(lastOfMonth), 6);
  const weeks: string[][] = [];
  for (let monday = first; monday <= last; monday = addDays(monday, 7)) {
    weeks.push([0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(monday, offset)));
  }
  return { first, last, weeks };
}

// El primer día del mes que queda `months` meses antes o después ("2026-11-23", 1 → "2026-12-01").
export function shiftMonth(date: string, months: number): string {
  const [year = 0, month = 1] = date.split("-").map(Number);
  return dateOf(new Date(Date.UTC(year, month - 1 + months, 1)));
}
