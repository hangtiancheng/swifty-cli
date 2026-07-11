import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/types.ts"],
      reporter: ["text", "html", "lcov"],
    },
  },
});
