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
