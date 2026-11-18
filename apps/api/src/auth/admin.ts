import { nameSchema, passwordSchema, phoneSchema } from "@caro/shared";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { loginThrottles, sessions, users } from "../db/schema.js";
import { hashPassword } from "./password.js";

// Valida un campo con el esquema compartido y lanza el mensaje de error tal cual.
type SafeParser<T> = {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
};

function parse<T>(schema: SafeParser<T>, value: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Dato inválido.");
  return result.data;
}

// Crea la cuenta admin de Caro. Si el teléfono ya existe, lo vuelve admin y
// actualiza el nombre y la contraseña (sirve también para recuperar el acceso).
export async function createAdmin(
  db: Database,
  input: { name: string; phone: string; password: string },
) {
  const name = parse(nameSchema, input.name);
  const phone = parse(phoneSchema, input.phone);
  const password = parse(passwordSchema, input.password);
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name, phone, passwordHash, role: "admin", consentAcceptedAt: new Date() })
      .onConflictDoUpdate({
        target: users.phone,
        set: { name, passwordHash, role: "admin", updatedAt: sql`now()` },
      })
      .returning({ id: users.id, name: users.name, phone: users.phone, role: users.role });

    if (!user) throw new Error("No se pudo crear la cuenta admin.");

    // Si el teléfono ya estaba registrado (por ejemplo, alguien se adelantó con el
    // celular de Caro), se cierran todas sus sesiones: solo entra quien sepa la nueva
    // contraseña. También se quita un posible bloqueo por intentos fallidos.
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    await tx.delete(loginThrottles).where(eq(loginThrottles.phone, phone));
    return user;
  });
}
