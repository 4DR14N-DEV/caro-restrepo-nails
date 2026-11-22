import { runKeepAlive } from "../../src/db/keepalive.js";

// Función programada de Netlify: cada 6 horas consulta la base para que el proyecto gratis de
// Supabase no se pause por inactividad (D06). Solo corre en el deploy publicado (no en los
// previews) y no tiene URL pública. El horario está en UTC.
export default async () => {
  await runKeepAlive(process.env.DATABASE_URL);
};

export const config = {
  schedule: "0 */6 * * *",
};
