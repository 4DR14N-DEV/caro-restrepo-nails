import { defineConfig } from "vitest/config";

// Tests unitarios y de HTTP: no necesitan base de datos.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/db/**"],
  },
});
