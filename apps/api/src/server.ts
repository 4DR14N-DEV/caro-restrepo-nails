import { createApp } from "./app.js";
import { createDatabase } from "./db/client.js";
import { pushServiceFromEnv } from "./push/sender.js";

// Servidor para desarrollo local. En producción la app corre en Netlify Functions.
const port = Number(process.env.PORT ?? 3000);
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("Falta DATABASE_URL (ver .env.example).");
}

const { db } = createDatabase(url);

createApp({ db, push: pushServiceFromEnv(process.env) }).listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
