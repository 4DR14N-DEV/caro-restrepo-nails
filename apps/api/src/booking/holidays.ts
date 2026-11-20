import { addDays, isoWeekday } from "./dates.js";

// Festivos de Colombia (Ley 51 de 1983), calculados para cualquier año: no hay que
// cargarlos en la base cada año.
const FIXED = ["01-01", "05-01", "07-20", "08-07", "12-08", "12-25"];
// Ley Emiliani: si no caen en lunes, pasan al lunes siguiente.
const MOVED_TO_MONDAY = ["01-06", "03-19", "06-29", "08-15", "10-12", "11-01", "11-11"];
// Días desde el domingo de Pascua: Jueves y Viernes Santo no se trasladan; Ascensión,
// Corpus Christi y Sagrado Corazón ya incluyen el traslado al lunes.
const FROM_EASTER = [-3, -2, 43, 64, 71];

// Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano).
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nextMonday(date: string): string {
  const weekday = isoWeekday(date);
  return weekday === 1 ? date : addDays(date, 8 - weekday);
}

const byYear = new Map<number, string[]>();

// Fechas en orden y sin repetir: dos festivos pueden caer el mismo lunes.
export function colombianHolidays(year: number): readonly string[] {
  let holidays = byYear.get(year);
  if (!holidays) {
    const easter = easterSunday(year);
    const dates = new Set([
      ...FIXED.map((day) => `${year}-${day}`),
      ...MOVED_TO_MONDAY.map((day) => nextMonday(`${year}-${day}`)),
      ...FROM_EASTER.map((days) => addDays(easter, days)),
    ]);
    holidays = [...dates].sort();
    byYear.set(year, holidays);
  }
  return holidays;
}

// Domingos y festivos no se atiende (RF20).
export function isClosedDay(date: string): boolean {
  return isoWeekday(date) === 7 || colombianHolidays(Number(date.slice(0, 4))).includes(date);
}
