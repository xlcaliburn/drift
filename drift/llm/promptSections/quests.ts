import { castHomeLocation } from "@/shared/quests";
import type { Section } from "./types";

/**
 * ACTIVE JOB block (QUESTS.md). Feeds the narrator the jobs the player has taken on
 * and the NEXT concrete step of each, so the fiction bends toward the work the
 * engine is tracking. The engine DETECTS completion from real signals (arrival, a
 * won fight, a successful roll) and pays out — the narrator only dramatizes the
 * beats and must NOT declare a job done or hand over a reward itself.
 */
export const activeJobs: Section = ({ jobs, state }) => {
  const active = (jobs ?? []).filter((j) => j.status === "active");
  if (!active.length) return [];
  const locName = (id?: string) => (id ? state.locations.find((l) => l.id === id)?.name ?? id : "somewhere unnamed");
  const here = state.campaign.currentLocationId;
  const lines = active.map((j) => {
    const next = j.objectives.find((o) => !o.done);
    const step = next ? next.summary : "wrap it up";
    // TRAVEL FRAMING (HANDOFF_PLAYTEST_POLISH_2.md) — the engine already knows
    // where this step happens; nothing said so explicitly, so a player asking
    // "where are we going?" got a pitched NEW job instead of an answer, and
    // "full burn for home" read as escaping the step rather than completing it.
    // Born from the live Ludo playtest.
    const travel = next?.locationId
      ? next.locationId === here
        ? ` [the player is AT ${locName(next.locationId)} now — play the step out here]`
        : ` [destination: ${locName(next.locationId)} — the player is at ${locName(here)}, NOT there yet; getting there IS the step. Never narrate the hand-off before the engine reports arrival]`
      : "";
    const freight = j.cargo ? ` [they are CARRYING ${j.cargo} — real inventory; it leaves their hands ONLY when the engine reports delivery. Never narrate it sold, handed off early, or duplicated]` : "";
    // CAST (HANDOFF Task D): the fixed people this job involves — the model
    // narrates them, it never invents an ADDITIONAL gang member/middleman/
    // contact for a tracked job (rule 8 in jsonSystem.ts backs this).
    // `?? []`: jobs load as raw jsonb (no Zod parse), so a pre-manifest job has
    // no `cast` — the load path normalizes, but a stale warm session wouldn't.
    const castMembers = j.cast ?? [];
    const cast = castMembers.length
      ? ` [cast — use EXACTLY these people, invent no one else for this job: ${castMembers
          .map((m) => `${m.role} ${m.name} (${m.roleLabel}, at ${locName(castHomeLocation(j, m.role))})`)
          .join("; ")}]`
      : "";
    return `  - ${j.title}: next → ${step}${j.complication ? ` (complication: ${j.complication})` : ""}${travel}${freight}${cast}`;
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
  const lines = offered.map((j) => {
    // The giver is a real PERSON (HANDOFF Task D — decided at generation, though
    // not materialized into the cast until accepted): name them in the pitch.
    // `?? []`: legacy pre-manifest jobs carry no cast (raw-jsonb load).
    const giver = (j.cast ?? []).find((m) => m.role === "giver");
    const from = giver ? `from ${giver.name} (${giver.roleLabel}) for ${facName(j.factionId)}` : `from ${facName(j.factionId)}`;
    return `  - [${j.id}] "${j.title}" (${j.tier}, ${from}): ${j.blurb}`;
  });
  return [
    `WORK ON OFFER at this station (engine-generated — do NOT invent other paying jobs). This is BACKGROUND KNOWLEDGE, not a directive: on most turns mention NONE of it. Surface an offer ONLY when the player asks around for work, a scene naturally idles at a place work gets posted (a bar, a dock board), or the giver has organic business with them — as one light touch (a notice glimpsed, a half-heard pitch), never a sales push. NPCs have their own lives: they NEVER interrupt what the player is doing to pitch a job, never repeat an offer the player ignored, and never steer a conversation back to work the player didn't ask about. When the player clearly moves to take one, include a choice with acceptJob:"<its id>" (and if they walk away from an ACTIVE job, a choice with abandonJob:"<its id>"). The ENGINE sets pay and terms; never quote credit amounts:\n${lines.join("\n")}`,
    ``,
  ];
};
