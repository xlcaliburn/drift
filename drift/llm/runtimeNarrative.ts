import type { CampaignState, Character, WorldEvent, Thread, Attributes } from "@/shared/schemas";
import type { EngineEvent } from "@/engine";
import { advanceClock as advanceClockEngine, runSceneEnd } from "@/engine";
import { economy } from "@/content";
import { generateQuirk, generateBackstory, generateNpcFlavor } from "@/shared/npcFlavor";
import { validateAttributes } from "@/shared/respec";
import { shipIsOwned, shipThreadId } from "@/shared/recap";
import { bestArmor } from "./runtimeEconomy";
import {
  dispositionLabel,
  isSceneMove,
  MAX_BEATS,
  MAX_BEAT_CHARS,
  MAX_SITUATION_CHARS,
  DISPOSITION_MIN,
  DISPOSITION_MAX,
  MAX_RELATION_LOG,
  shortRole,
  toSecondPerson,
  type SceneCard,
  type NpcRelations,
  type NpcRelation,
} from "@/shared/scene";

/**
 * The narrative/world-state side of TurnRuntime, split out of engineBridge.ts as
 * free functions over a NarrativeRT surface. Covers clocks, faction rep (+ loaner
 * repossession), quest threads, world events, the scene-close pipeline, NPC
 * registration + presence + relationships, the scene card, and the Rook character
 * services (bodyMod/respec/setAppearance). Pure engine logic; the runtime is the
 * only mutator.
 */
/** The narrow surface the relationship helpers need — a subset satisfied by both
 *  NarrativeRT and runtimeCombat's CombatRT (rollCheck moves standing on a passed
 *  social check, so it must be able to call nudgeStandingFromCheck). */
export interface RelationRT {
  state: CampaignState;
  events: EngineEvent[];
  sceneCard: SceneCard;
  npcRelations: NpcRelations;
  nudgedThisTurn: Set<string>;
}

export interface NarrativeRT extends RelationRT {
  worldEvents: WorldEvent[];
  clockAdvances: { clockId: string; amount: number; reason: string }[];
  tickedThisScene: Set<string>;
  sceneEndReport: ReturnType<typeof runSceneEnd> | null;
  questCompletedThisTurn: boolean;
  markQuestCompleted(): void;
}

/** Standing with the faction whose loaner you fly, at/below which they repossess it. */
const SHIP_SEIZE_REP = -2;

const pcOf = (rt: NarrativeRT): Character | undefined => rt.state.characters.find((c) => c.kind === "pc");
const isDeadChar = (c: Character): boolean => (c.injuries ?? []).some((i) => i.name === "Dead");

export function advanceClock(rt: NarrativeRT, input: Record<string, unknown>) {
  const clockId = String(input.clockId);
  const clock = rt.state.clocks.find((c) => c.id === clockId);
  if (!clock) return { error: `unknown clock ${clockId}` };
  const amount = input.amount ? Number(input.amount) : 1;
  const reason = String(input.reason ?? "");
  // Preview the milestone effects now (authoritative apply happens at end_scene).
  const res = advanceClockEngine(clock, amount, reason);
  rt.clockAdvances.push({ clockId, amount, reason });
  rt.events.push(res.event);
  return { breakdown: res.event.breakdown, crossedMilestones: res.crossedMilestones };
}

export function adjustRep(rt: NarrativeRT, input: Record<string, unknown>) {
  const factionId = String(input.factionId);
  const delta = Number(input.delta);
  const rep = rt.state.factionRep.find((r) => r.factionId === factionId);
  if (!rep) return { error: `unknown faction ${factionId}` };
  const from = rep.rep;
  const to = Math.max(-5, Math.min(5, from + delta));
  rt.state = {
    ...rt.state,
    factionRep: rt.state.factionRep.map((r) =>
      r.factionId === factionId
        ? // Mark the faction as "encountered" the first time its rep is touched, so
          // the sheet keeps showing it even if rep later swings back to neutral 0.
          { ...r, rep: to, standing: r.standing ?? "Encountered" }
        : r,
    ),
  };
  rt.events.push({ type: "rep", breakdown: `Rep ${factionId}: ${from}→${to}`, factionId, from, to });

  // Loaner repossession: crater your standing with the faction whose ship you
  // fly — before you've earned the title — and they pull it. Deterministic
  // consequence (like a clock milestone); the narrator must narrate it.
  const pc = rt.state.characters.find((c) => c.kind === "pc");
  if (
    pc?.parentFactionId === factionId &&
    to <= SHIP_SEIZE_REP &&
    rt.state.ship &&
    !shipIsOwned(rt.state)
  ) {
    const shipName = rt.state.ship.name;
    const factionName = rt.state.factions.find((f) => f.id === factionId)?.name ?? "Your faction";
    rt.state = {
      ...rt.state,
      ship: undefined,
      threads: rt.state.threads.map((t) =>
        t.id === shipThreadId(rt.state.campaign.id)
          ? {
              ...t,
              title: "Earn a hull of your own",
              body: `${factionName} repossessed ${shipName} when your standing with them cratered. You're grounded — beg and borrow passage until you can get a hull that answers to you alone.`,
            }
          : t,
      ),
    };
    rt.events.push({
      type: "note",
      breakdown: `${factionName} repossessed ${shipName} — standing cratered to ${to}. You are grounded.`,
    });
    return { factionId, from, to, shipSeized: { name: shipName, by: factionId } };
  }

  return { factionId, from, to };
}

export function updateThread(rt: NarrativeRT, input: Record<string, unknown>) {
  const op = String(input.op);
  if (op === "create") {
    const thread: Thread = {
      id: `th-${Date.now()}`,
      campaignId: rt.state.campaign.id,
      title: String(input.title ?? "Untitled thread"),
      body: String(input.body ?? ""),
      status: "active",
      entityRefs: (input.entityRefs as string[]) ?? [],
    };
    rt.state = { ...rt.state, threads: [...rt.state.threads, thread] };
    return { created: thread.id };
  }
  const threadId = String(input.threadId);
  // Resolving a live thread is a quest completion — unlock disposition this turn.
  if (op === "resolve" && rt.state.threads.some((t) => t.id === threadId && t.status !== "resolved")) {
    rt.markQuestCompleted();
  }
  rt.state = {
    ...rt.state,
    threads: rt.state.threads.map((t) =>
      t.id === threadId
        ? {
            ...t,
            body: input.body ? String(input.body) : t.body,
            status: op === "resolve" ? "resolved" : t.status,
          }
        : t,
    ),
  };
  return { updated: threadId, op };
}

export function logWorldEvent(rt: NarrativeRT, input: Record<string, unknown>) {
  const ev: WorldEvent = {
    id: `we-${Date.now()}`,
    universeId: rt.state.universe.id,
    sourceCampaignId: rt.state.campaign.id,
    factionIds: (input.factionIds as string[]) ?? [],
    locationId: input.locationId ? String(input.locationId) : undefined,
    headline: String(input.headline),
    detail: input.detail ? String(input.detail) : undefined,
    visibility: "private", // universe owner promotes to 'canon' via review queue
  };
  rt.worldEvents.push(ev);
  rt.events.push({ type: "note", breakdown: `World event logged: ${ev.headline}` });
  return { logged: ev.id };
}

export function endScene(rt: NarrativeRT, input: Record<string, unknown>) {
  const report = runSceneEnd(rt.state, {
    paying: Boolean(input.paying),
    dockings: input.dockings ? Number(input.dockings) : 0,
    arrivedAtLocationId: input.arrivedAtLocationId ? String(input.arrivedAtLocationId) : undefined,
    // Ticks are awarded immediately in rollCheck now; nothing left to batch.
    tickedRolls: [],
    clockAdvances: rt.clockAdvances,
    combatEnded: Boolean(input.combatEnded),
    tendaysDelta: input.tendaysDelta ? Number(input.tendaysDelta) : 0,
  });
  rt.state = report.state;
  // Stabilise the wounded between scenes: a Downed (but living) character is
  // patched up — cleared of Downed and brought to at least 1 HP — so nobody
  // carries a bleeding-out, 0-HP crisis (or a soft-lock) into the next scene.
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((c) => {
      if (isDeadChar(c)) return c;
      if (!(c.injuries ?? []).some((i) => i.name === "Downed")) return c;
      return { ...c, hp: Math.max(1, c.hp), injuries: c.injuries.filter((i) => i.name !== "Downed") };
    }),
  };
  rt.sceneEndReport = report;
  // New scene → the per-scene tick cap resets.
  rt.tickedThisScene.clear();
  rt.events.push(...report.events);
  return {
    title: input.title,
    checklist: report.checklist,
  };
}

/** A same-(base-)named cast member's id + role, as far as `resolveNpcNameMatch`
 *  needs to know. */
interface NameCandidate {
  id: string;
  role?: string;
}

/**
 * Which existing same-named cast member (if any) THIS mention refers to, and
 * whether it's actually a DIFFERENT person sharing the name (a collision) —
 * CHECKS.md §2. Two distinct fictional people sharing a first name (a live case:
 * a courier "Ren" already in the party, then a bar-fixer ALSO introduced as "Ren")
 * used to silently MERGE into one record — the second person's oneBreath/role
 * overwrote (or was swallowed by) the first's, corrupting canon for whichever one
 * was actually on-screen. Resolution, cheapest signal first:
 *  - no existing candidate → nothing to resolve, not a collision.
 *  - the incoming mention carries no role → no signal to disambiguate with, fall
 *    back to the FIRST candidate (previous behavior, unchanged).
 *  - a candidate's role matches the incoming role → same person, found.
 *  - a candidate has NO role yet → same person, adopting the incoming role.
 *  - every candidate has a role and NONE match → a genuinely different person.
 */
export function resolveNpcNameMatch(
  candidates: NameCandidate[],
  role: string | undefined,
): { existingId?: string; collision: boolean } {
  if (candidates.length === 0) return { collision: false };
  if (!role) return { existingId: candidates[0].id, collision: false };
  const r = role.toLowerCase();
  const roleMatch = candidates.find((c) => c.role && c.role.toLowerCase() === r);
  if (roleMatch) return { existingId: roleMatch.id, collision: false };
  const unroled = candidates.find((c) => !c.role);
  if (unroled) return { existingId: unroled.id, collision: false };
  return { collision: true };
}

/** Strips a prior disambiguation suffix ("Ren (fixer)" → "ren") so a later mention
 *  of the qualified name still finds the same record, and a fresh mention of the
 *  ORIGINAL bare name still recognizes it as sharing that name. */
function baseNameOf(n: string): string {
  return n.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "");
}

/**
 * Persist a named NPC the narrator introduced/used this turn, so the world
 * REMEMBERS them (continuity — an NPC recognized on return). Deduped by name (and,
 * when two people share a name, by ROLE — see `resolveNpcNameMatch`). Returns
 * whether a new NPC was created.
 */
export function registerNpc(rt: NarrativeRT, name: string, oneBreath?: string, role?: string): { added: boolean; id: string } {
  const trimmed = name.trim();
  const here = rt.state.campaign.currentLocationId;
  const cleanRole = shortRole(role); // a short handle, never a descriptive clause
  // NEVER register the player's own character as an NPC. The cheap model attributes
  // a line to the PC's SHORT name ("Wren" for "Wren Sung"), which — since the short
  // form isn't in the known-entity set — spawned a duplicate person and shattered
  // continuity (Angela's "it created another NPC called Wren"). Block an exact match
  // or a first-name match against any PC/crew name.
  const tn = trimmed.toLowerCase();
  const isPlayerName = rt.state.characters.some((c) => {
    const cn = c.name.toLowerCase();
    return cn === tn || cn.split(/\s+/)[0] === tn || cn === tn.split(/\s+/)[0];
  });
  if (isPlayerName) return { added: false, id: "" };
  const sameBaseName = rt.state.npcs.filter((n) => baseNameOf(n.name) === tn);
  const { existingId, collision } = resolveNpcNameMatch(sameBaseName, cleanRole);
  const existing = existingId ? sameBaseName.find((n) => n.id === existingId) : undefined;
  if (existing) {
    rt.state = {
      ...rt.state,
      npcs: rt.state.npcs.map((n) =>
        n.id === existing.id
          ? {
              ...n,
              // SET-ONCE, like role/oneBreath/quirk below — never relocate an already-
              // known NPC's canonical home just because they were quoted this turn. A
              // dialogue-speaker backstop fires on a comms call or a remembered line as
              // readily as a real appearance; without this an NPC's home silently drifts
              // to wherever they were last MENTIONED, and "nearby"/"[immediate]" tags
              // (world.ts, StatusTab) start reading them as still being wherever the
              // player currently stands — the live "Steward still nearby at Halcyon"
              // bug, the same class the patron-specific exemption below was already
              // patching one NPC at a time.
              locationId: n.locationId ?? here,
              oneBreath: n.oneBreath || oneBreath || n.oneBreath,
              // Fill a role only if we didn't already know one (set-once).
              role: n.role ?? cleanRole,
              // Backfill canonical flavor for NPCs that predate it (set-once).
              quirk: n.quirk ?? generateQuirk(n.id),
              backstory: n.backstory ?? (n.originCampaignId ? generateBackstory(n.id) : undefined),
            }
          : n,
      ),
    };
    return { added: false, id: existing.id };
  }
  // COLLISION: a role-bearing mention doesn't match any already-known person
  // sharing this base name, and at least one of them has a DIFFERENT known role —
  // two distinct people. Fold the role into the stored name so every future mention
  // (and the People/sheet display) tells them apart from here on, matching the
  // fiction's own likely acknowledgment of the coincidence ("same name, different
  // game"). `baseNameOf` strips this suffix again on the NEXT mention, so a later
  // registerNpc("Ren", ..., "fixer") re-matches THIS record via the role check above
  // instead of colliding — and re-matches the ORIGINAL "Ren" via its own role too.
  const displayName = collision ? `${trimmed} (${cleanRole})` : trimmed;
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "npc";
  const id = `npc-gen-${slug}-${rt.state.npcs.length}`;
  const npc = {
    id,
    universeId: rt.state.universe.id,
    name: displayName,
    oneBreath: (oneBreath ?? "").trim() || `Someone the player met${here ? " here" : ""}.`,
    ...(here ? { locationId: here } : {}),
    ...(cleanRole ? { role: cleanRole } : {}),
    // Provenance so a promoted NPC (persistSession) traces back to this campaign.
    originCampaignId: rt.state.campaign.id,
    // Canonical personality + backstory hook — engine-generated, shared, set once.
    ...generateNpcFlavor(id),
  };
  rt.state = { ...rt.state, npcs: [...rt.state.npcs, npc] };
  return { added: true, id };
}

/** Force-refresh a cast NPC's one-line identity (scene analyst upgrading a thin/
 *  placeholder oneBreath). Unlike registerNpc this OVERWRITES — the caller gates
 *  on isPlaceholderOneBreath so real, authored canon is never clobbered. */
export function setNpcOneBreath(rt: NarrativeRT, id: string, oneBreath: string, role?: string) {
  const text = oneBreath.trim();
  if (!text) return;
  rt.state = {
    ...rt.state,
    npcs: rt.state.npcs.map((n) => (n.id === id ? { ...n, oneBreath: text, role: n.role ?? shortRole(role) } : n)),
  };
}

/** Mark an NPC as present in the current scene — they ride retrieval every turn
 *  of the scene without needing to be re-named (CONTINUITY tier NOW). */
export function markPresent(rt: NarrativeRT, npcId: string) {
  if (!npcId) return; // registerNpc returns "" when it refused (e.g. the PC's own name)
  if (!rt.sceneCard.presentNpcIds.includes(npcId)) rt.sceneCard.presentNpcIds.push(npcId);
}

/** Apply the model's scene-card proposal: `situation`/`place`/`dangers` overwrite,
 *  `beats` append. Engine caps everything (F-2/F-4). */
export function updateScene(rt: NarrativeRT, situation?: string, beats?: string[], place?: string, dangers?: string[]) {
  if (situation?.trim()) rt.sceneCard.situation = situation.trim().slice(0, MAX_SITUATION_CHARS);
  if (place?.trim()) {
    const incoming = place.trim().slice(0, 120);
    // A genuinely new place = the player moved on; the old crowd is left behind.
    // Clear present NPCs so the new place's cast repopulates from this turn's
    // narration. A reword/elaboration (isSceneMove gate) must NOT wipe the cast.
    if (rt.sceneCard.place && isSceneMove(rt.sceneCard.place, incoming, undefined, undefined)) {
      rt.sceneCard.presentNpcIds = [];
    }
    rt.sceneCard.place = incoming;
  }
  // Overwrite semantics: [] explicitly CLEARS a dealt-with danger.
  if (dangers) rt.sceneCard.dangers = dangers.map((d) => d.trim().slice(0, 80)).filter(Boolean).slice(0, 3);
  for (const b of beats ?? []) {
    const beat = b.trim().slice(0, MAX_BEAT_CHARS);
    if (!beat) continue;
    if (rt.sceneCard.beats.some((x) => x.toLowerCase() === beat.toLowerCase())) continue;
    if (rt.sceneCard.beats.length >= MAX_BEATS) rt.sceneCard.beats.shift(); // oldest out
    rt.sceneCard.beats.push(beat);
  }
}

/** Keep Here & now LIVE: when the model didn't set a `situation` this turn, derive
 *  it from the turn's narration (first sentence, capped). */
export function refreshSituation(rt: NarrativeRT, narration: string) {
  const text = narration.trim();
  if (!text) return;
  const first = text.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? text;
  const s = first.trim().replace(/\s+/g, " ").slice(0, MAX_SITUATION_CHARS);
  if (s) rt.sceneCard.situation = s;
}

/** Append a beat to a relationship's history log (oldest→newest, capped), so the
 *  People panel shows how things DEVELOPED. Skips a repeat of the most recent note. */
function pushRelationLog(rt: RelationRT, rel: NpcRelation, note: string): void {
  const trimmed = note.trim().slice(0, 160);
  if (!trimmed) return;
  const log = rel.log ?? [];
  if (log.length && log[log.length - 1].note === trimmed) return; // no consecutive dupes
  log.push({ note: trimmed, scene: rt.sceneCard.seq });
  rel.log = log.slice(-MAX_RELATION_LOG);
}

/**
 * Move standing toward the scene's sole present NPC from a social CHECK outcome:
 * +1 on success (+2 on a crit), -1 on a fumble. Capped 1/NPC/turn. Standing is
 * EARNED by a rolled check, not granted on whim. Skips when the target is ambiguous
 * (0 or >1 present), already nudged this turn, or at the cap. Returns a display line.
 */
export function nudgeStandingFromCheck(
  rt: RelationRT,
  outcome: string,
  critical: boolean,
  criticalFailure: boolean,
): string | undefined {
  const present = rt.sceneCard.presentNpcIds ?? [];
  if (present.length !== 1) return undefined; // ambiguous or nobody in the room
  const npcId = present[0];
  if (rt.nudgedThisTurn.has(npcId)) return undefined;
  const delta = criticalFailure ? -1 : critical ? 2 : outcome === "success" ? 1 : 0;
  if (delta === 0) return undefined;
  const rel = rt.npcRelations[npcId] ?? { disposition: 0 };
  const before = rel.disposition;
  const to = Math.max(DISPOSITION_MIN, Math.min(DISPOSITION_MAX, before + delta));
  if (to === before) return undefined; // already maxed/floored
  rt.nudgedThisTurn.add(npcId);
  rel.disposition = to;
  const name = rt.state.npcs.find((n) => n.id === npcId)?.name ?? npcId;
  rel.lastNote =
    delta > 0
      ? `Warmed to you — now ${dispositionLabel(to)}.`
      : `Cooled toward you — now ${dispositionLabel(to)}.`;
  rel.lastSceneSeq = rt.sceneCard.seq;
  pushRelationLog(rt, rel, rel.lastNote);
  rt.npcRelations[npcId] = rel;
  rt.events.push({
    type: "note",
    breakdown: `${name} standing ${before}→${to} (social check)`,
  });
  return `👤 ${name}: ${dispositionLabel(before)} → ${dispositionLabel(to)}`;
}

/**
 * Update the player's standing with an NPC (CONTINUITY tier CANON). The model
 * proposes; the engine owns the math: delta clamped to ±1, one nudge per NPC per
 * turn (only on a quest-completion turn), range −3..+3. `relationship` is set-once;
 * `note` overwrites (rolling last-interaction memory) and accumulates in the log.
 */
export function updateNpcRelation(
  rt: NarrativeRT,
  npcId: string,
  upd: { disposition?: number; note?: string; relationship?: string },
): { line?: string } {
  const rel = rt.npcRelations[npcId] ?? { disposition: 0 };
  let line: string | undefined;
  if (upd.disposition && rt.questCompletedThisTurn && !rt.nudgedThisTurn.has(npcId)) {
    rt.nudgedThisTurn.add(npcId);
    const delta = Math.max(-1, Math.min(1, Math.round(upd.disposition)));
    const to = Math.max(DISPOSITION_MIN, Math.min(DISPOSITION_MAX, rel.disposition + delta));
    if (to !== rel.disposition) {
      const name = rt.state.npcs.find((n) => n.id === npcId)?.name ?? npcId;
      line = `👤 ${name}: ${dispositionLabel(rel.disposition)} → ${dispositionLabel(to)}`;
      rel.disposition = to;
    }
  }
  // Notes/relationship are shown to the player as "what you know" — keep them second
  // person ("You handed over the core", not "Player handed over…").
  const pcName = pcOf(rt)?.name;
  if (upd.relationship?.trim() && !rel.relationship) rel.relationship = toSecondPerson(upd.relationship.trim(), pcName);
  if (upd.note?.trim()) {
    rel.lastNote = toSecondPerson(upd.note.trim(), pcName).slice(0, 160);
    rel.lastSceneSeq = rt.sceneCard.seq;
    pushRelationLog(rt, rel, rel.lastNote);
  }
  rt.npcRelations[npcId] = rel;
  return { line };
}

/**
 * Rook Station body-modification service (Chrome's studio). For a flat fee the
 * artist reshapes APPEARANCE and works the change into their STORY. Elective, so
 * REFUSED when they can't afford it. Gated to Rook; the engine owns the writes.
 */
export function bodyMod(rt: NarrativeRT, input: { appearance?: string; story?: string }): { line?: string; error?: string } {
  const pc = pcOf(rt);
  if (!pc) return { error: "no character" };
  if (rt.state.campaign.currentLocationId !== "loc-rook") {
    return { error: "the body artist keeps a studio on Rook Station only" };
  }
  const cost = economy.constants.bodyModCost ?? 500;
  if ((pc.credits ?? 0) < cost) return { error: `can't afford the work (¢${cost}, holding ¢${pc.credits ?? 0})` };
  const appearance = input.appearance?.trim();
  const story = input.story?.trim();
  if (!appearance && !story) return { error: "no change described" };

  const after = (pc.credits ?? 0) - cost;
  const backstory = story ? `${pc.backstory ? `${pc.backstory}\n\n` : ""}${story}` : pc.backstory;
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((c) =>
      c.id === pc.id
        ? { ...c, credits: after, ...(appearance ? { appearance } : {}), ...(backstory !== undefined ? { backstory } : {}) }
        : c,
    ),
  };
  rt.events.push({ type: "cost", breakdown: `Body work at Chrome's — -¢${cost}`, amount: -cost });
  return { line: `💉 Reshaped under Chrome's needles — ¢${cost}. You walk out someone new. ¢${after} left.` };
}

/**
 * Full character re-customization at Chrome's (Rook). For the flat fee the player
 * may RENAME, REALLOCATE attributes (within the creation budget — shared/respec),
 * and reshape APPEARANCE. Derived stats recompute; current HP is CLAMPED to the new
 * cap (no free heal). The campaign name follows a rename. Refused when unaffordable.
 */
export function respec(rt: NarrativeRT, input: { name?: string; attributes?: Attributes; appearance?: string }): { line?: string; error?: string } {
  const pc = pcOf(rt);
  if (!pc) return { error: "no character" };
  if (rt.state.campaign.currentLocationId !== "loc-rook") {
    return { error: "Chrome's studio is on Rook Station only" };
  }
  const cost = economy.constants.bodyModCost ?? 500;
  if ((pc.credits ?? 0) < cost) return { error: `can't afford the work (¢${cost}, holding ¢${pc.credits ?? 0})` };

  const name = input.name?.trim();
  const appearance = input.appearance?.trim();
  const changingAttrs = !!input.attributes;
  if (!name && !appearance && !changingAttrs) return { error: "no change made" };

  let attributes = pc.attributes;
  let maxHp = pc.maxHp;
  let hp = pc.hp;
  let ac = pc.ac;
  if (input.attributes) {
    const v = validateAttributes(input.attributes);
    if (!v.ok) return { error: v.error };
    attributes = input.attributes;
    maxHp = Math.max(1, 18 + attributes.vitality);
    hp = Math.min(pc.hp, maxHp); // remade, not healed — clamp to the new cap
    ac = 10 + attributes.reflex + bestArmor(pc.gear);
  }

  const after = (pc.credits ?? 0) - cost;
  const oldName = pc.name;
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((c) =>
      c.id === pc.id
        ? { ...c, credits: after, attributes, maxHp, hp, ac, ...(name ? { name } : {}), ...(appearance ? { appearance } : {}) }
        : c,
    ),
  };
  // The campaign is named after the PC at creation — keep them in sync on rename.
  if (name && rt.state.campaign.name === oldName) {
    rt.state = { ...rt.state, campaign: { ...rt.state.campaign, name } };
  }
  rt.events.push({ type: "cost", breakdown: `Remade at Chrome's — -¢${cost}`, amount: -cost });
  const bits = [name && "a new name", changingAttrs && "a reworked build", appearance && "a new look"]
    .filter(Boolean)
    .join(", ");
  return { line: `💉 Remade under Chrome's needles — ${bits}. ¢${cost}, ¢${after} left.` };
}

/** Set the PC's appearance text WITHOUT charging (the polished description the
 *  respec endpoint generates after the remake is applied). */
export function setAppearance(rt: NarrativeRT, text: string) {
  const pc = pcOf(rt);
  if (!pc) return;
  const appearance = text.trim();
  if (!appearance) return;
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((c) => (c.id === pc.id ? { ...c, appearance } : c)),
  };
}
