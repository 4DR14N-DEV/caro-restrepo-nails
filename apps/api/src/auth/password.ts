import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// Parámetros mínimos recomendados por OWASP para Argon2id (19 MiB, 2 iteraciones).
// El algoritmo por defecto de @node-rs/argon2 ya es Argon2id.
const options = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

let dummyHash: Promise<string> | undefined;

// Cuando el teléfono no existe se verifica igual contra un hash ficticio,
// así la respuesta tarda lo mismo y no revela qué cuentas existen.
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verify(await dummyHash, password);
  return false;
}
