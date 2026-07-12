/**
 * One-time import: validate the hand-transcribed DRIFT seed against the Zod
 * schemas and (optionally) push it to Supabase.
 *
 *   npm run import-save            # validate only (dry run)
 *   npm run import-save -- --push  # validate then upsert to Supabase
 *
 * The dry run needs no environment and is the migration trust-check: it proves
 * the save file round-trips through the schema cleanly before any DB exists.
 */
import {
  Universe,
  Campaign,
  Character,
  Ship,
  Faction,
  FactionRep,
  Location,
  Npc,
  Clock,
  Thread,
  Contract,
  Scene,
  WorldEvent,
} from "@/shared/schemas";
import * as seed from "./seedData";

function validate() {
  const checks: [string, () => unknown][] = [
    ["universe", () => Universe.parse(seed.universe)],
    ["campaign", () => Campaign.parse(seed.campaign)],
    ["characters", () => [seed.vess, seed.denna, seed.josen].map((c) => Character.parse(c))],
    ["ship", () => Ship.parse(seed.lark)],
    ["factions", () => seed.factions.map((f) => Faction.parse(f))],
    ["factionRep", () => seed.factionRep.map((f) => FactionRep.parse(f))],
    ["locations", () => seed.locations.map((l) => Location.parse(l))],
    ["npcs", () => seed.npcs.map((n) => Npc.parse(n))],
    ["clocks", () => seed.clocks.map((c) => Clock.parse(c))],
    ["threads", () => seed.threads.map((t) => Thread.parse(t))],
    ["contracts", () => seed.contracts.map((c) => Contract.parse(c))],
    ["resolvedScenes", () => seed.resolvedScenes.map((s) => Scene.parse(s))],
    ["worldEvents", () => seed.worldEvents.map((w) => WorldEvent.parse(w))],
  ];

  let ok = 0;
  for (const [name, fn] of checks) {
    try {
      const v = fn();
      const count = Array.isArray(v) ? v.length : 1;
      console.log(`  ✓ ${name} (${count})`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
      throw err;
    }
  }
  console.log(`\nValidated ${ok}/${checks.length} entity groups. Seed is schema-clean.`);
}

async function push() {
  const { getServiceClient, toRow } = await import("@/db/queries");
  const db = getServiceClient();
  const state = seed.buildCampaignState();
  console.log("Pushing to Supabase…");

  await db.from("universes").upsert(toRow(state.universe));
  await db.from("campaigns").upsert(toRow(state.campaign));
  await db.from("factions").upsert(state.factions.map(toRow));
  await db.from("locations").upsert(state.locations.map(toRow));
  await db.from("npcs").upsert(state.npcs.map(toRow));
  await db.from("characters").upsert(state.characters.map(toRow));
  if (state.ship) await db.from("ships").upsert(toRow(state.ship));
  await db.from("faction_rep").upsert(state.factionRep.map(toRow));
  await db.from("clocks").upsert(state.clocks.map(toRow));
  await db.from("threads").upsert(state.threads.map(toRow));
  await db.from("contracts").upsert(state.contracts.map(toRow));
  await db.from("scenes").upsert(seed.resolvedScenes.map(toRow));
  await db.from("world_events").upsert(seed.worldEvents.map(toRow));
  console.log("Push complete.");
}

async function main() {
  console.log("DRIFT save import — validating seed against Zod schemas:\n");
  validate();
  if (process.argv.includes("--push")) {
    await push();
  } else {
    console.log("\n(dry run — pass --push to upsert into Supabase)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
