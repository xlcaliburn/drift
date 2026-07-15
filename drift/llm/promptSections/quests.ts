import type { Section } from "./types";

/**
 * ACTIVE JOB block (QUESTS.md). Feeds the narrator the jobs the player has taken on
 * and the NEXT concrete step of each, so the fiction bends toward the work the
 * engine is tracking. The engine DETECTS completion from real signals (arrival, a
 * won fight, a successful roll) and pays out — the narrator only dramatizes the
 * beats and must NOT declare a job done or hand over a reward itself. Offered jobs
 * live on the player-facing board (the Jobs tab), not here, to keep the slice lean.
 */
export const activeJobs: Section = ({ jobs }) => {
  const active = (jobs ?? []).filter((j) => j.status === "active");
  if (!active.length) return [];
  const lines = active.map((j) => {
    const next = j.objectives.find((o) => !o.done);
    const step = next ? next.summary : "wrap it up";
    return `  - ${j.title}: next → ${step}${j.complication ? ` (complication: ${j.complication})` : ""}`;
  });
  return [
    `ACTIVE JOBS the player has taken (weave the NEXT step into the fiction; the ENGINE tracks completion and pays the reward — never declare a job done or grant credits yourself):\n${lines.join("\n")}`,
    ``,
  ];
};
