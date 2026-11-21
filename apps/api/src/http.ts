import type { Response } from "express";

// Si lo que llegó no es un objeto (sin cuerpo, un arreglo, un texto), zod da su mensaje
// en inglés: se reemplaza por uno para la clienta.
const NOT_AN_OBJECT = "Los datos enviados no son válidos.";

// Primer mensaje de error por campo, listo para mostrar en el formulario. Los errores
// que no son de un campo (por ejemplo, un cambio vacío) van en `form`.
export function invalidInput(
  res: Response,
  error: { issues: { path: PropertyKey[]; message: string; code?: string }[] },
): void {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    const wholeBody = issue.path.length === 0 && issue.code === "invalid_type";
    fields[field] ??= wholeBody ? NOT_AN_OBJECT : issue.message;
  }
  res.status(400).json({ error: "invalid_input", fields });
}
