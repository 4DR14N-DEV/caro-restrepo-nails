import { createDatabase } from "./client.js";
import { seed } from "./seed-data.js";

// Uso: DATABASE_URL=... pnpm db:seed
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("Falta DATABASE_URL (ver .env.example).");
}

const { db, pool } = createDatabase(url);
await seed(db);
await pool.end();
console.log("Datos iniciales cargados.");
