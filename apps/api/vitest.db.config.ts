import { defineConfig } from "vitest/config";

// Tests de integración contra Postgres real. Requieren TEST_DATABASE_URL.
// Corren en serie porque comparten la misma base.
export default defineConfig({
  test: {
    include: ["test/db/**/*.test.ts"],
    fileParallelism: false,
  },
});
