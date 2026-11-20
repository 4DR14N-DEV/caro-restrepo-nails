import type { Response } from "express";

// Primer mensaje de error por campo, listo para mostrar en el formulario. Los errores
// que no son de un campo (por ejemplo, un cambio vacío) van en `form`.
export function invalidInput(
  res: Response,
  error: { issues: { path: PropertyKey[]; message: string }[] },
): void {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    fields[field] ??= issue.message;
  }
  res.status(400).json({ error: "invalid_input", fields });
}
