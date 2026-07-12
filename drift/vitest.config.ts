import { defineConfig } from "vitest/config";

// Map "@/..." to the project root without the ESM-only tsconfig-paths plugin.
const root = process.cwd();

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    globals: true,
  },
});
