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

// Cuando el teléfono no existe se verifica igual contra un hash ficticio, así la
// respuesta tarda lo mismo y no revela qué cuentas existen. Se calcula al cargar el
// módulo para que el primer ingreso de cada instancia no tarde más que los demás.
const dummyHash = hashPassword(randomBytes(16).toString("hex"));

export async function verifyAgainstDummy(password: string): Promise<false> {
  await verify(await dummyHash, password);
  return false;
}
