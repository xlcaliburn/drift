import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { TurnPlan } from "@/shared/turnPlan";
import type { RNG } from "@/engine";
import { freshSceneCard, carryScene, type NpcRelations, type SceneMemory } from "@/shared/scene";
import { FACTS_CAP, type Fact } from "@/shared/facts";
import { appendTranscript, type ChatEntry } from "@/shared/chat";
import { TurnRuntime } from "./engineBridge";
import { applyPlan, type ApplyCtx } from "./applyPlan";
import { buildContextSlice, retrieveEntities } from "./promptBuilder";
import { inferPresentNpcs } from "./jsonTurn";

/**
 * THE CONTINUITY GYM (CONTINUITY_HARDENING.md Task 3): a scripted, MODEL-FREE
 * regression harness proving established context SURVIVES window turnover —
 * many scene closes, transcript trimming, retrieval decay, name collisions.
 * Every existing check in CHECKS.md was born from a live incident; this file
 * is the proactive counterpart — replay the SHAPE of those incidents through
 * the real engine seams before a player ever hits them again. It's also the
 * acceptance harness for a future world reboot and the gate for the D-3
 * history-window shrink (CONTINUITY_HARDENING.md Task 7).
 *
 * Seams driven, all real production code, zero model calls: `TurnRuntime` +
 * `applyPlan(plan, ctx)` for mechanical turns (exactly `applyPlan.test.ts`'s
 * pattern), `carryScene`/`appendTranscript` for scene lifecycle, and
 * `buildContextSlice`/`retrieveEntities`/`inferPresentNpcs` for what the
 * narrator would actually be shown.
 *
 * NOTE on scope: `lib/analystRun.applyAnalystUpdates` is the scene analyst's
 * OWN fold path, but `lib/*` carries `import "server-only"`, which throws
 * under Vitest's plain Node module resolution (confirmed empirically — it
 * fails to resolve at all, not just at runtime). So these scenarios drive the
 * SAME underlying engine mutations the analyst ultimately triggers
 * (registerNpc / setNpcOneBreath / applyFactUpdates, all via TurnRuntime +
 * applyPlan) rather than the analyst's LLM call or its SessionData wrapper.
 * What's under test — caps, dedupe, retrieval, prompt assembly — is identical
 * on both paths; scene-analyst OUTPUT is modeled as hand-scripted summaries,
 * matching how `compressClosedScene` would persist them regardless of which
 * model produced them.
 */

const rng: RNG = { int: (min: number) => min };

function baseState(): CampaignState {
  return {
    campaign: { id: "camp-gym", universeId: "u", currentLocationId: "loc-x", tendaysElapsed: 0 },
    universe: { id: "u", name: "Test" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false,
        credits: 200,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [], factionRep: [],
    locations: [
      { id: "loc-x", universeId: "u", name: "Dock X", tags: [] },
      { id: "loc-freeport", universeId: "u", name: "Freeport", tags: [] },
    ],
    npcs: [],
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

function mkPlan(over: Partial<TurnPlan>): TurnPlan {
  return { narration: "", choices: [], clockAdvances: [], ...over } as TurnPlan;
}

/**
 * A tiny session-shaped accumulator mirroring lib/state.SessionData's
 * continuity-bearing slices. `turn()` builds a FRESH TurnRuntime each call —
 * exactly like a real HTTP request — fed the SAME sceneCard/npcRelations/facts
 * references so mutations carry forward turn to turn, matching production.
 */
function gym(initialState: CampaignState) {
  const acc = {
    state: initialState,
    sceneCard: freshSceneCard(),
    npcRelations: {} as NpcRelations,
    facts: [] as Fact[],
    recentScenes: [] as SceneMemory[],
    transcript: [] as ChatEntry[],
  };

  function turn(plan: TurnPlan): TurnRuntime {
    const runtime = new TurnRuntime(acc.state, rng, {
      sceneCard: acc.sceneCard,
      npcRelations: acc.npcRelations,
      facts: acc.facts,
    });
    const ctx: ApplyCtx = {
      runtime,
      preState: acc.state,
      pc: runtime.state.characters[0],
      emit: () => {},
      toolCalls: [],
      lastRoll: null,
      combat: null,
      reconcile: [],
    };
    applyPlan(plan, ctx);
    acc.state = runtime.state;
    acc.sceneCard = runtime.sceneCard;
    acc.npcRelations = runtime.npcRelations;
    acc.facts = runtime.facts;
    acc.transcript = appendTranscript(
      acc.transcript,
      [{ role: "player", text: plan.narration || "..." }, { role: "dm", text: plan.narration || "..." }],
      acc.sceneCard,
    );
    return runtime;
  }

  /** Close the current scene: push a SCRIPTED summary (the analyst's OUTPUT
   *  shape — see file header) onto recentScenes, capped at 20 exactly like
   *  the real route (`app/api/turn/route.ts` compressClosedScene), then open
   *  the next scene at the current transcript tail. */
  function closeScene(summary: Omit<SceneMemory, "seq">) {
    const scene: SceneMemory = { seq: acc.sceneCard.seq, ...summary };
    acc.recentScenes = [...acc.recentScenes.filter((s) => s.seq !== scene.seq), scene]
      .sort((a, b) => a.seq - b.seq)
      .slice(-20);
    acc.sceneCard = carryScene(acc.sceneCard, acc.transcript.length);
  }

  function context(playerText = ""): string {
    return buildContextSlice(acc.state, playerText, [], undefined, true, {
      sceneCard: acc.sceneCard,
      npcRelations: acc.npcRelations,
      recentScenes: acc.recentScenes,
      facts: acc.facts,
    });
  }

  return { acc, turn, closeScene, context };
}

describe("the continuity gym — established context survives window turnover", () => {
  it("1. FACTS SURVIVE THE WINDOW: a struck deal outlives 15+ scene closes, and a restated deal replaces it (not duplicates)", () => {
    const g = gym(baseState());
    g.turn(mkPlan({ facts: [{ text: "Split with Kaela on the crate: 50/50 — agreed", entityRefs: [] }] }));
    for (let i = 0; i < 15; i++) g.closeScene({ title: `Scene ${i}`, summary: `Filler beat ${i}.`, entityRefs: [] });
    expect(g.context()).toContain("50/50");

    g.turn(mkPlan({ facts: [{ text: "Split with Kaela on the crate now 60/40 — renegotiated", entityRefs: [] }] }));
    const kaelaFacts = g.acc.facts.filter((f) => f.text.toLowerCase().includes("kaela"));
    expect(kaelaFacts).toHaveLength(1);
    expect(kaelaFacts[0].text).toContain("60/40");
    const ctx = g.context();
    expect(ctx).toContain("60/40");
    expect(ctx).not.toContain("50/50");
  });

  it("2. ALIASES NEVER FORK: a name-collision NPC keeps its harvested alias, a later bare mention of the alias adds nothing, and retrieval finds them by it", () => {
    const g = gym(baseState());
    g.turn(
      mkPlan({
        narration: "Ren waves you over from the dock, sizing you up.",
        npcs: [{ name: "Ren", oneBreath: "A sharp, scarred courier.", role: "courier" }],
      }),
    );
    expect(g.acc.state.npcs).toHaveLength(1);

    // A DIFFERENT Ren, disambiguated by role — her oneBreath reveals her full name.
    g.turn(
      mkPlan({
        narration:
          "A woman taps the dockmaster's ledger. \"Renwick Duross,\" she says. \"Ren to everyone who's ever needed a favor.\"",
        npcs: [
          {
            name: "Ren",
            oneBreath: "Renwick Duross on the dockmaster's ledger, \"Ren\" to everyone who's ever needed a favor.",
            role: "fixer",
          },
        ],
      }),
    );
    expect(g.acc.state.npcs).toHaveLength(2);
    const fixer = g.acc.state.npcs.find((n) => n.role === "fixer")!;
    expect(fixer.name).toBe("Ren (fixer)");
    expect(fixer.aliases).toContain("Renwick");

    // A later bare "Renwick" mention resolves to the SAME record — no third Ren.
    g.turn(mkPlan({ narration: "Renwick nods and slips back into the crowd.", npcs: [{ name: "Renwick" }] }));
    expect(g.acc.state.npcs).toHaveLength(2);

    // Retrieval finds her by the alias alone.
    const { npcs: found } = retrieveEntities(g.acc.state, "ask renwick about the wreck", []);
    expect(found.some((n) => n.id === fixer.id)).toBe(true);
  });

  it("3. SCENE SUMMARIES DECAY, FACTS DON'T: a promise ages out of the 20-scene window, but the fact recorded alongside it survives", () => {
    const g = gym(baseState());
    g.closeScene({ title: "Scene 1", summary: "Docked at the station, took stock.", entityRefs: [] });
    g.closeScene({ title: "Scene 2", summary: "Promised Dex a meet at the Rust Bucket.", entityRefs: [] });
    g.turn(mkPlan({ facts: [{ text: "Meeting Dex at the Rust Bucket, two hours", entityRefs: [] }] }));

    // Still well within the 20-scene cap — the promise's summary is present.
    for (let i = 0; i < 10; i++) g.closeScene({ title: `Scene ${i + 3}`, summary: `Filler beat ${i}.`, entityRefs: [] });
    expect(g.context()).toContain("Rust Bucket");

    // Push it out: 21 more closes evicts scene 2 from the 20-entry cap.
    for (let i = 0; i < 21; i++) g.closeScene({ title: `Scene ${i + 13}`, summary: `Filler beat ${i + 10}.`, entityRefs: [] });
    expect(g.acc.recentScenes.some((s) => s.summary.includes("Rust Bucket"))).toBe(false);
    // The SCENE mention is gone, but the FACT — a separate, independently-capped
    // tier — is untouched: the two memory tiers complement each other.
    const ctx = g.context();
    expect(ctx).toContain("Rust Bucket"); // from ESTABLISHED FACTS, not PREVIOUSLY
    expect(g.acc.facts.some((f) => f.text.includes("Rust Bucket"))).toBe(true);
  });

  it("4. TRIM SAFETY: a scene that grows the transcript past the cap mid-scene still slices to EXACTLY its own entries (Task 1's fix)", () => {
    const sceneCard = { startTranscriptIdx: 380 };
    let transcript: ChatEntry[] = Array.from({ length: 380 }, (_, i) => ({ role: "player", text: `pre-scene ${i}` }));
    const sceneEntries: ChatEntry[] = [];
    for (let i = 0; i < 10; i++) {
      const adds: ChatEntry[] = [
        { role: "player", text: `turn ${i}` },
        { role: "dm", text: `beat ${i}` },
        { role: "system", text: `engine ${i}` },
      ];
      sceneEntries.push(...adds);
      transcript = appendTranscript(transcript, adds, sceneCard);
    }
    const slice = transcript.slice(sceneCard.startTranscriptIdx);
    expect(slice).toEqual(sceneEntries); // not empty, not the tail — exactly the scene
  });

  it("5. PRESENCE INVARIANTS HOLD TOGETHER: a remote NPC over comms is gated out; a traveling companion survives a location change", () => {
    const npcs = [
      { id: "npc-quist", name: "Quist", locationId: "loc-freeport" },
      { id: "npc-sera", name: "Sera" }, // no fixed home — a companion riding along
    ];
    // Home gate: Quist is based elsewhere — a comms call never counts as presence.
    const gated = inferPresentNpcs(
      "Quist's voice crackles over the comm. 'Stay sharp out there.'",
      "the docking bay",
      "",
      npcs,
      "loc-x",
    );
    expect(gated.has("npc-quist")).toBe(false);

    // Companion exemption: Sera was present LAST scene, so she's exempt from the
    // gate even after the party moved somewhere new — a real speaking beat still
    // marks her present via the normal quote-attribution heuristic.
    const companion = inferPresentNpcs(
      "Sera checks the corridor ahead. 'Clear.'",
      "a new corridor",
      "",
      npcs,
      "loc-x",
      new Set(["npc-sera"]),
    );
    expect(companion.has("npc-sera")).toBe(true);
  });

  it("6. FACTS CAP holds through the real plan->applyPlan path: 21 distinct facts leaves exactly 20, oldest evicted", () => {
    const g = gym(baseState());
    for (let i = 0; i < FACTS_CAP + 1; i++) {
      g.turn(mkPlan({ facts: [{ text: `Contact-${i} holds berth-${i} rate-${i} standing`, entityRefs: [] }] }));
    }
    expect(g.acc.facts).toHaveLength(FACTS_CAP);
    expect(g.acc.facts.some((f) => f.text.includes("Contact-0"))).toBe(false); // evicted
    expect(g.acc.facts.some((f) => f.text.includes(`Contact-${FACTS_CAP}`))).toBe(true); // newest kept
  });
});
