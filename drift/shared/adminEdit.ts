import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { Character, Ship, Thread, Clock, Npc, FactionRep, type CampaignState } from "@/shared/schemas";
import { ChoiceOption } from "@/shared/turnPlan";
import { catalogItem } from "@/shared/items";
import type { ChatEntry } from "@/shared/chat";
import type { CombatState } from "@/shared/combat";
import {
  carryScene,
  MAX_BEATS,
  MAX_BEAT_CHARS,
  MAX_SITUATION_CHARS,
  DISPOSITION_MIN,
  DISPOSITION_MAX,
  type SceneCard,
  type NpcRelations,
  type SceneMemory,
} from "@/shared/scene";

/**
 * Admin CAMPAIGN EDITOR — the op vocabulary + the PURE applier the admin API runs
 * against a loaded session. Kept out of lib/state.ts (server-only) so it stays
 * vitest-testable: it operates on a structural `EditableSlices`, returns the new
 * slices + a one-line summary (for the visible ⚙ GM transcript note) + any DB
 * FOLLOW-UPS the caller must run after persistSession (deletes/clears that an
 * upsert-only persist can't express — else stale rows resurrect on cold load).
 */

// ── Zod mirrors for the two continuity types that aren't Zod schemas ──────────
const SceneCardZ = z.object({
  seq: z.number().int(),
  turnCount: z.number().int().min(0),
  presentNpcIds: z.array(z.string()),
  situation: z.string().max(MAX_SITUATION_CHARS),
  place: z.string().optional(),
  placeSeq: z.number().int().optional(),
  beats: z.array(z.string().max(MAX_BEAT_CHARS)).max(MAX_BEATS),
  dangers: z.array(z.string()).optional(),
  startTranscriptIdx: z.number().int().min(0),
  pendingPickup: z.object({ name: z.string(), itemId: z.string().optional(), note: z.string().optional() }).optional(),
});

const NpcRelationZ = z.object({
  relationship: z.string().optional(),
  disposition: z.number().int().min(DISPOSITION_MIN).max(DISPOSITION_MAX),
  lastNote: z.string().optional(),
  log: z.array(z.object({ note: z.string(), scene: z.number().int().optional() })).optional(),
  lastSceneSeq: z.number().int().optional(),
  nameKnown: z.boolean().optional(),
});
const NpcRelationsZ = z.record(z.string(), NpcRelationZ);

const CampaignPatch = z
  .object({
    name: z.string().min(1).optional(),
    directive: z.string().max(400).nullable().optional(),
    currentLocationId: z.string().nullable().optional(),
    situation: z.string().nullable().optional(),
    status: z.enum(["active", "archived", "deceased"]).optional(),
    narratorModel: z.string().nullable().optional(),
    tendaysElapsed: z.number().int().min(0).optional(),
  })
  .strict();

// ── The op union (the PATCH body; `visible` is read separately by the route) ──
export const AdminOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("character"), value: Character }),
  z.object({ op: z.literal("ship"), value: Ship.nullable() }),
  z.object({ op: z.literal("threads"), value: z.array(Thread) }),
  z.object({ op: z.literal("clocks"), value: z.array(Clock) }),
  z.object({ op: z.literal("npcs"), value: z.array(Npc) }), // edit/add ONLY — removals via deleteNpcs
  z.object({ op: z.literal("deleteNpcs"), ids: z.array(z.string()).min(1) }),
  z.object({ op: z.literal("factionRep"), value: z.array(FactionRep) }),
  z.object({ op: z.literal("campaign"), value: CampaignPatch }),
  z.object({ op: z.literal("sceneCard"), value: SceneCardZ }),
  z.object({ op: z.literal("npcRelations"), value: NpcRelationsZ }),
  z.object({ op: z.literal("setChoices"), value: z.array(ChoiceOption) }),
  z.object({ op: z.literal("clearChoices") }),
  z.object({ op: z.literal("endCombat") }),
  z.object({ op: z.literal("revive"), characterId: z.string().optional() }),
  z.object({ op: z.literal("gmNote"), value: z.string().min(1).max(1000) }),
  z.object({ op: z.literal("newScene") }),
  z.object({ op: z.literal("sceneSummary"), value: z.object({ seq: z.number().int(), title: z.string(), summary: z.string() }) }),
]);
export type AdminOp = z.infer<typeof AdminOp>;

/** The subset of a SessionData an op may touch (structural — no server-only dep). */
export interface EditableSlices {
  state: CampaignState;
  history: Anthropic.MessageParam[];
  transcript: ChatEntry[];
  combat: CombatState | null;
  sceneCard: SceneCard;
  npcRelations: NpcRelations;
  recentScenes: SceneMemory[];
  lastChoices: ChoiceOption[];
  tickedThisScene: string[];
}

/** DB writes an upsert-only persistSession can't express — run AFTER it. */
export type DbFollowup =
  | { kind: "deleteNpcs"; ids: string[] }
  | { kind: "deleteThreads"; ids: string[] }
  | { kind: "deleteClocks"; ids: string[] }
  | { kind: "clearDeathSaves"; characterId: string }
  | { kind: "saveScene"; scene: SceneMemory };

export interface AdminOpResult {
  slices: EditableSlices;
  /** One line describing the change — becomes the visible ⚙ GM transcript note. */
  summary: string;
  followups: DbFollowup[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const isGenNpc = (id: string) => id.startsWith("npc-gen-") || id.startsWith("npc-rel-");

/** Mirror of engineBridge.ts setGear/bestArmor — AC = 10 + reflex + BEST single
 *  armor piece (not summed). Kept as a 4-line copy to avoid importing TurnRuntime. */
function bestArmor(gear: Character["gear"] | undefined): number {
  return Math.max(0, ...(gear ?? []).map((g) => g.acBonus ?? (g.itemId ? catalogItem(g.itemId)?.acBonus ?? 0 : 0)));
}

/**
 * Apply one admin op to the slices. Pure (returns fresh slices; never mutates the
 * argument). Throws only on a truly-impossible op (unknown character id).
 */
export function applyAdminOp(slices: EditableSlices, op: AdminOp): AdminOpResult {
  const s = slices;
  const st = s.state;
  const followups: DbFollowup[] = [];

  switch (op.op) {
    case "character": {
      const existing = st.characters.find((c) => c.id === op.value.id);
      if (!existing) throw new Error(`no character ${op.value.id} in this campaign`);
      const merged: Character = {
        ...op.value,
        // id / campaignId / kind are immutable (an id change duplicates the DB row).
        id: existing.id,
        campaignId: existing.campaignId,
        kind: existing.kind,
      };
      merged.hp = clamp(merged.hp, 0, merged.maxHp);
      if (merged.hp > 0) merged.injuries = (merged.injuries ?? []).filter((i) => i.name !== "Downed");
      // Honor an explicit AC change; otherwise derive it from gear (so a gear edit
      // updates AC without the admin doing the math).
      merged.ac = op.value.ac !== existing.ac ? op.value.ac : 10 + (merged.attributes?.reflex ?? 0) + bestArmor(merged.gear);
      return {
        slices: { ...s, state: { ...st, characters: st.characters.map((c) => (c.id === merged.id ? merged : c)) } },
        summary: `adjusted ${merged.name}`,
        followups,
      };
    }
    case "ship":
      return { slices: { ...s, state: { ...st, ship: op.value ?? undefined } }, summary: op.value ? "updated the ship" : "removed the ship", followups };
    case "threads": {
      const removed = st.threads.filter((t) => !op.value.some((v) => v.id === t.id)).map((t) => t.id);
      if (removed.length) followups.push({ kind: "deleteThreads", ids: removed });
      return { slices: { ...s, state: { ...st, threads: op.value } }, summary: "updated the story threads", followups };
    }
    case "clocks": {
      const removed = st.clocks.filter((c) => !op.value.some((v) => v.id === c.id)).map((c) => c.id);
      if (removed.length) followups.push({ kind: "deleteClocks", ids: removed });
      return { slices: { ...s, state: { ...st, clocks: op.value } }, summary: "updated the clocks", followups };
    }
    case "npcs": {
      // Edit/add only — override matching ids, keep the rest, append the new.
      const byId = new Map(st.npcs.map((n) => [n.id, n] as const));
      for (const n of op.value) byId.set(n.id, n);
      return { slices: { ...s, state: { ...st, npcs: [...byId.values()] } }, summary: "updated the NPC cast", followups };
    }
    case "deleteNpcs": {
      // Only generated NPCs may be deleted — seed cast is shared universe canon.
      const ids = op.ids.filter(isGenNpc);
      if (!ids.length) return { slices: s, summary: "no deletable NPCs (seed cast is protected)", followups };
      const npcRelations = { ...s.npcRelations };
      for (const id of ids) delete npcRelations[id];
      followups.push({ kind: "deleteNpcs", ids }); // + hard-delete the universe rows
      return {
        slices: {
          ...s,
          state: { ...st, npcs: st.npcs.filter((n) => !ids.includes(n.id)) },
          sceneCard: { ...s.sceneCard, presentNpcIds: s.sceneCard.presentNpcIds.filter((id) => !ids.includes(id)) },
          npcRelations,
        },
        summary: `removed ${ids.length} NPC${ids.length > 1 ? "s" : ""}`,
        followups,
      };
    }
    case "factionRep":
      return { slices: { ...s, state: { ...st, factionRep: op.value } }, summary: "updated faction standing", followups };
    case "campaign": {
      // Drop undefined so a partial patch doesn't wipe unset fields.
      const patch = Object.fromEntries(Object.entries(op.value).filter(([, v]) => v !== undefined));
      return { slices: { ...s, state: { ...st, campaign: { ...st.campaign, ...patch } } }, summary: "updated campaign settings", followups };
    }
    case "sceneCard":
      return { slices: { ...s, sceneCard: op.value }, summary: "edited the scene", followups };
    case "npcRelations":
      return { slices: { ...s, npcRelations: op.value }, summary: "edited relationships", followups };
    case "setChoices":
      return { slices: { ...s, lastChoices: op.value }, summary: "set the offered choices", followups };
    case "clearChoices":
      return { slices: { ...s, lastChoices: [] }, summary: "cleared the offered choices", followups };
    case "endCombat":
      // Also drop stale combat chips so the next click doesn't misroute.
      return { slices: { ...s, combat: null, lastChoices: [] }, summary: "ended the fight", followups };
    case "revive": {
      const pcId = op.characterId ?? st.characters.find((c) => c.kind === "pc")?.id;
      let name = "the character";
      const characters = st.characters.map((c) => {
        if (c.id !== pcId) return c;
        name = c.name;
        return {
          ...c,
          injuries: (c.injuries ?? []).filter((i) => i.name !== "Downed" && i.name !== "Dead"),
          hp: Math.max(1, c.hp),
          deathSaves: undefined, // cleared in-memory; DB column cleared via followup (upsert drops nulls)
        };
      });
      if (pcId) followups.push({ kind: "clearDeathSaves", characterId: pcId });
      const campaign = st.campaign.status === "deceased" ? { ...st.campaign, status: "active" as const } : st.campaign;
      return { slices: { ...s, state: { ...st, characters, campaign }, combat: null, lastChoices: [] }, summary: `revived ${name}`, followups };
    }
    case "gmNote": {
      const history: Anthropic.MessageParam[] = [
        ...s.history,
        { role: "user", content: `[GM NOTE — out-of-character instruction to you, the narrator; NOT player speech. ${op.value}]` },
      ];
      return { slices: { ...s, history }, summary: "sent a note to the narrator", followups };
    }
    case "newScene":
      return {
        slices: { ...s, sceneCard: carryScene(s.sceneCard, s.transcript.length), tickedThisScene: [] },
        summary: "started a fresh scene",
        followups,
      };
    case "sceneSummary": {
      const scene: SceneMemory = {
        seq: op.value.seq,
        title: op.value.title,
        summary: op.value.summary,
        entityRefs: s.recentScenes.find((r) => r.seq === op.value.seq)?.entityRefs ?? [],
        locationId: s.recentScenes.find((r) => r.seq === op.value.seq)?.locationId,
      };
      followups.push({ kind: "saveScene", scene }); // scenes table isn't touched by persistSession
      return {
        slices: { ...s, recentScenes: [...s.recentScenes.filter((r) => r.seq !== scene.seq), scene].sort((a, b) => a.seq - b.seq) },
        summary: `fixed the scene-${op.value.seq} summary`,
        followups,
      };
    }
  }
}
