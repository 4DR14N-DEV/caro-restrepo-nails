// Códigos de error de Postgres que la API traduce a respuestas.
export const UNIQUE_VIOLATION = "23505";
export const EXCLUSION_VIOLATION = "23P01";
// Dos reservas que se pisan pueden esperarse una a la otra; Postgres corta una.
export const DEADLOCK = "40P01";
// Se venció el `lock_timeout` esperando un bloqueo.
export const LOCK_NOT_AVAILABLE = "55P03";

// Drizzle puede envolver el error del driver, así que se mira también la causa.
export function hasPgCode(error: unknown, code: string): boolean {
  const codeOf = (value: unknown) => (value as { code?: unknown } | null)?.code;
  return codeOf(error) === code || codeOf((error as { cause?: unknown } | null)?.cause) === code;
}

// Qué pasó al guardar una cita con el turno del día tomado: el turno no se liberó a tiempo
// ("busy"), o la restricción de exclusión frenó una superposición, también si dos escrituras
// se esperaban una a la otra ("clash"). Cada ruta responde con su propio mensaje.
export function writeConflict(error: unknown): "busy" | "clash" | undefined {
  if (hasPgCode(error, LOCK_NOT_AVAILABLE)) return "busy";
  if (hasPgCode(error, EXCLUSION_VIOLATION) || hasPgCode(error, DEADLOCK)) return "clash";
  return undefined;
}
