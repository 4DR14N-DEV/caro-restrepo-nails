import { createApp } from "./app.js";

// Servidor para desarrollo local. En producción la app corre en Netlify Functions.
const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
