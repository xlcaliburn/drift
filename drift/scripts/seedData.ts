/**
 * DRIFT shared-world canon — now a thin re-export of the CONTENT PACK
 * (content/pack/), which is the single authored source of world truth. This
 * module keeps its old import surface (`universe`, `factions`, `locations`,
 * `npcs`) so existing importers (lib/newCampaign, content/openings, the seed
 * script, fixtures) don't churn; new code should import from @/content/pack
 * directly.
 */
export { UNIVERSE_ID, universe, factions, locations, seedNpcs as npcs } from "@/content/pack";
