"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/preset.ts
var preset_exports = {};
__export(preset_exports, {
  default: () => preset_default
});
module.exports = __toCommonJS(preset_exports);
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
