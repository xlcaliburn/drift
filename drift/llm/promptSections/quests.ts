import type { Section } from "./types";

/**
 * ACTIVE JOB block (QUESTS.md). Feeds the narrator the jobs the player has taken on
 * and the NEXT concrete step of each, so the fiction bends toward the work the
 * engine is tracking. The engine DETECTS completion from real signals (arrival, a
 * won fight, a successful roll) and pays out — the narrator only dramatizes the
 * beats and must NOT declare a job done or hand over a reward itself.
 */
export const activeJobs: Section = ({ jobs }) => {
  const active = (jobs ?? []).filter((j) => j.status === "active");
  if (!active.length) return [];
  const lines = active.map((j) => {
    const next = j.objectives.find((o) => !o.done);
    const step = next ? next.summary : "wrap it up";
    const freight = j.cargo ? ` [they are CARRYING ${j.cargo} — real inventory; it leaves their hands ONLY when the engine reports delivery. Never narrate it sold, handed off early, or duplicated]` : "";
    return `  - ${j.title}: next → ${step}${j.complication ? ` (complication: ${j.complication})` : ""}${freight}`;
  });
  return [
    `ACTIVE JOBS the player has taken (weave the NEXT step into the fiction; the ENGINE tracks completion and pays the reward — never declare a job done or grant credits yourself):\n${lines.join("\n")}`,
    ``,
  ];
};

/**
 * WORK ON OFFER (QUESTS.md — diegetic offers). The browsable job-board tab is gone:
 * engine-generated offers at THIS station reach the player only through the fiction —
 * a fixer's pitch, dock chatter, a posted notice, a patron's ask. The model surfaces
 * them naturally and, when the player moves to take one, emits a choice carrying the
 * job's id in `acceptJob` so the engine flips it offered→active. The engine still
 * OWNS the jobs (structure, pay, expiry); the model only voices them.
 */
export const offeredJobs: Section = ({ state, jobs, loc }) => {
  const here = loc?.id;
  const offered = (jobs ?? []).filter(
    (j) => j.status === "offered" && (!j.postedLocationId || j.postedLocationId === here),
  );
  if (!offered.length) return [];
  const facName = (id?: string) =>
    (id && state.factions.find((f) => f.id === id)?.name) || "an independent broker";
  const lines = offered.map(
    (j) => `  - [${j.id}] "${j.title}" (${j.tier}, from ${facName(j.factionId)}): ${j.blurb}`,
  );
  return [
    `WORK ON OFFER at this station (engine-generated — do NOT invent other paying jobs). Surface these through the WORLD when it fits — a fixer's pitch, dock chatter, a notice, the giver themselves — never as a menu or list. When the player clearly moves to take one, include a choice with acceptJob:"<its id>" (and if they walk away from an ACTIVE job, a choice with abandonJob:"<its id>"). The ENGINE sets pay and terms; never quote credit amounts:\n${lines.join("\n")}`,
    ``,
  ];
};
