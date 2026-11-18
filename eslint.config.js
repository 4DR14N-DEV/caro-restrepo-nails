import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.astro/**",
      "**/.netlify/**",
      "**/node_modules/**",
      "**/drizzle/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  // Desactiva las reglas de estilo que ya resuelve Prettier.
  prettier,
);
