import type { Config } from "tailwindcss";
import driftPreset from "./src/preset";

export default {
  presets: [driftPreset],
  // vocabulary.ts is plain data scanned for class names — it widens the
  // compiled utility set beyond what the components themselves use.
  content: ["./src/**/*.{ts,tsx}"],
} satisfies Config;
