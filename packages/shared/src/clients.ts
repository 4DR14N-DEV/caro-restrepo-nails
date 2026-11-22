import type { ClientSummary } from "./agenda.js";

// Clientas en el panel de Caro (RF17), compartido por la API y la web.

export interface ClientRow extends ClientSummary {
  // Fecha de registro en Bogotá, "2026-10-05".
  registeredOn: string;
  // Citas agendadas desde ahora.
  upcoming: number;
}

// La clave nueva se muestra una sola vez: no se guarda en claro en ningún lado.
export interface PasswordReset {
  client: ClientSummary;
  password: string;
}

// Mensaje de WhatsApp para pasarle la clave nueva a la clienta.
export function newPasswordMessage({ name, password }: { name: string; password: string }): string {
  return `Hola ${name}, soy Caro. Tu nueva contraseña es ${password}. Ingresa con tu celular y esta contraseña; puedes cambiarla en "Mis citas".`;
}
