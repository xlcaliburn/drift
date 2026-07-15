/**
 * Prompt-assembly FACADE. The pieces were split out so parallel work doesn't
 * collide: the JSON system contract lives in `jsonSystem.ts`, entity retrieval in
 * `retrieval.ts`, and the per-turn context sections in `promptSections/`. This
 * module re-exports the stable public surface so every consumer (jsonTurn + tests)
 * keeps importing from the one place.
 */
export { buildJsonSystem } from "./jsonSystem";
export { retrieveEntities } from "./retrieval";
export { buildContextSlice } from "./promptSections";
export { reachableDossiers } from "./promptSections/world";
