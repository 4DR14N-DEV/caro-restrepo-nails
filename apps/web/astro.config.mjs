import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Sitio estático: las páginas públicas salen como HTML y las partes interactivas
// (reserva y panel de Caro) se montan como islas de React.
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
