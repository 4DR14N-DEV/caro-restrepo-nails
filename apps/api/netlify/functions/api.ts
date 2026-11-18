import serverless from "serverless-http";
import { createApp } from "../../src/app.js";
import { createDatabase } from "../../src/db/client.js";

// Adaptador de Netlify Functions: único archivo que conoce la plataforma.
// DATABASE_URL debe apuntar al pooler de Supabase en modo transacción (puerto 6543).
// Sin ella, /api/health sigue respondiendo y las rutas que usan la base fallan con 500.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL en las variables de entorno de Netlify.");
}

// Una conexión por instancia: cada función atiende una petición a la vez.
const { db } = createDatabase(url ?? "", { max: 1 });

export const handler = serverless(createApp({ db }));
