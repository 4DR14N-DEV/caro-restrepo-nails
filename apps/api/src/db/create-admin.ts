import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createAdmin } from "../auth/admin.js";
import { createAsk } from "./ask.js";
import { createDatabase } from "./client.js";

// Uso: DATABASE_URL=... pnpm db:create-admin
// Pide nombre, celular y contraseña; la contraseña no se muestra al escribirla.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("Falta DATABASE_URL (ver .env.example).");
}

// Salida que se puede silenciar mientras se escribe la contraseña.
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
// En una terminal, readline maneja el eco (para poder ocultar la contraseña); con una
// entrada por tubería no hay eco que ocultar.
const prompt = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });

const ask = createAsk(
  prompt,
  (text) => process.stdout.write(text),
  () => {
    muted = false;
    console.error("\nCancelado: no se creó ninguna cuenta.");
    process.exit(1);
  },
);

async function askHidden(question: string): Promise<string> {
  muted = true;
  const answer = await ask(question);
  muted = false;
  process.stdout.write("\n");
  return answer;
}

const name = await ask("Nombre: ");
const phone = await ask("Celular (10 dígitos): ");
const password = await askHidden("Contraseña (mínimo 8 caracteres): ");
const confirmation = await askHidden("Repite la contraseña: ");
prompt.close();

if (password !== confirmation) {
  console.error("Las contraseñas no coinciden.");
  process.exit(1);
}

const { db, pool } = createDatabase(url);
try {
  const user = await createAdmin(db, { name, phone, password });
  console.log(`Cuenta admin lista: ${user.name} (${user.phone}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
