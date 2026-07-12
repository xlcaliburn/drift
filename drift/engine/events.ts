/**
 * Typed records emitted by engine functions. They feed three consumers:
 * the UI dice log, the DB (rolls/state deltas), and the narrator's tool results.
 * Every event carries a human-readable `breakdown` for direct display.
 */
export type EngineEvent =
  | { type: "roll"; breakdown: string; skill: string; total: number; dc?: number; outcome: string; tickEligible: boolean }
  | { type: "attack"; breakdown: string; hit: boolean; damage: number }
  | { type: "damage"; breakdown: string; targetId: string; amount: number; hpAfter: number }
  | { type: "tick"; breakdown: string; characterId: string; skill: string; leveledUp: boolean }
  | { type: "clock"; breakdown: string; clockId: string; from: number; to: number; milestones: string[] }
  | { type: "resource"; breakdown: string; field: string; delta: number }
  | { type: "cost"; breakdown: string; amount: number }
  | { type: "rep"; breakdown: string; factionId: string; from: number; to: number }
  | { type: "note"; breakdown: string };

export function note(breakdown: string): EngineEvent {
  return { type: "note", breakdown };
}
