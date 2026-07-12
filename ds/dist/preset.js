// src/preset.ts
var driftPreset = {
  theme: {
    extend: {
      colors: {
        /** Page background — near-black blue. */
        ink: "#0b0e14",
        /** Raised surface — cards, bubbles, modals. */
        panel: "#141922",
        /** Hairline borders and dividers. */
        edge: "#232b38",
        /** Brand amber — primary actions, active states, warnings. */
        accent: "#e8a33d",
        /** Positive — health, success, approvals. */
        good: "#5fb37a",
        /** Negative — damage, errors, threat clocks. */
        bad: "#d9584a"
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      }
    }
  }
};
var preset_default = driftPreset;
export {
  preset_default as default
};
