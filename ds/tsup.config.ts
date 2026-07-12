import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", preset: "src/preset.ts" },
  format: ["esm", "cjs"],
  dts: true,
  external: ["react", "react/jsx-runtime"],
  clean: true,
});
