import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Sitio estático: las páginas públicas salen como HTML y las partes interactivas
// (reserva y panel de Caro) se montan como islas de React.
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // En desarrollo, /api va a la API local (pnpm --filter @caro/api dev), igual que en
    // Netlify: mismo origen, así la cookie de sesión funciona sin CORS.
    server: {
      proxy: {
        "/api": "http://localhost:3000",
      },
    },
  },
});
