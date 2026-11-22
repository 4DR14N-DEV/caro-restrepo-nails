import { z } from "zod";

// Esquemas de autenticación compartidos por la API y la web.
// Los mensajes son textos de UI: la web los muestra tal cual.

const phoneMessage = "Escribe un celular de 10 dígitos que empiece por 3.";

// Celular colombiano. La clienta escribe 10 dígitos (con o sin separadores ni +57)
// y se guarda en formato E.164: +573001234567.
export const phoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s\-()]/g, "").replace(/^\+?57(?=3\d{9}$)/, ""))
  .pipe(z.string().regex(/^3\d{9}$/, phoneMessage))
  .transform((digits) => `+57${digits}`);

// Sin reglas de composición (OWASP). El máximo evita hashear textos enormes.
export const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .max(128, "La contraseña puede tener máximo 128 caracteres.");

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Escribe tu nombre.")
  .max(80, "El nombre puede tener máximo 80 caracteres.");

export const registerSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  password: passwordSchema,
  // Ley 1581 de 2012: sin aceptación no hay registro.
  consent: z.literal(true, "Debes aceptar la política de tratamiento de datos."),
});

// En el ingreso no se aplica el mínimo de 8: solo se compara con el hash guardado.
export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, "Escribe tu contraseña.").max(128, "Contraseña incorrecta."),
});

// Confirmar con la contraseña actual (cambiarla o borrar la cuenta). Como en el ingreso,
// no se aplica el mínimo de 8: solo se compara con el hash guardado.
export const wrongPasswordMessage = "La contraseña actual no es correcta.";
export const currentPasswordSchema = z
  .string("Escribe tu contraseña actual.")
  .min(1, "Escribe tu contraseña actual.")
  .max(128, wrongPasswordMessage);

export const changePasswordSchema = z.object({
  currentPassword: currentPasswordSchema,
  newPassword: passwordSchema,
});

export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export type RegisterInput = z.input<typeof registerSchema>;
export type RegisterData = z.output<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type LoginData = z.output<typeof loginSchema>;

// Usuario tal como lo devuelve la API.
export interface PublicUser {
  id: string;
  name: string;
  phone: string;
  role: "admin" | "client";
}
