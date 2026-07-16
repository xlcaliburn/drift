# CANON.md — world constants (curated vs. procedural)

*Direction chosen 2026-07-16 after a live report (Angela / Wren Sung): the world felt
incoherent — "makes up places and people and forgets them immediately", an NPC named
after her own character, crates/data cores from nowhere. Root cause was a shared-world
NPC BLEED, and the broader fix is to move DRIFT toward a curated set of CONSTANTS the
narrator draws from, instead of unbounded procedural invention that the cheap model
can't remember. This doc tracks that shift.*

## The diagnosis (from Wren's live data)

Wren's campaign carried **36 NPCs — only 5 her own; 31 bled in from other players'
campaigns** (4 were other campaigns' *patron* NPCs), plus 15 thin placeholders
("Mentioned in the scene", "Spoke with the player"). Mechanism: `loadCampaignState`
loaded **every** NPC in the universe (`.eq("universe_id", …)`), and every campaign
promotes its generated NPCs to that shared table — so all 31 strangers flooded her
cast. The model, drowning in people it never established in HER story, reinvented and
forgot them → "no continuity". Compounding bugs: an NPC registered with the PC's own
name ("Wren"), mentioned-only and bare-role registrations ("Guard"), weak dedup
("Yuri"/"Dockmaster Yuri", "Corso"/"Korso"), and a campaign-BLIND persist filter that
re-saved foreign NPCs into her runtime so they accreted forever.

## Locked decision (revises a prior "everything procedural + fully shared" stance)

- **The shared world is a small CURATED cast of constants**, not every campaign's
  procedural fixers. Each player's emergent NPCs stay PRIVATE to their campaign.
  Cross-player *character* cameos still ride the gated dossiers/ledger (MULTIPLAYER.md),
  not raw NPC flooding.
- **Bound invention.** The narrator should prefer the constants and only invent when the
  fiction genuinely needs a new face — and a new face becomes a tracked NPC, not a
  disposable name. Same principle for **places** (canonical locations, not vanishing
  free-text) and **items** (catalog + defined cargo, not random crates/data cores).

## Phase 1 — stop the NPC bleed + the PC-name dupe (SHIPPED 2026-07-16)

- `db/queries.ts` `loadCampaignState` — loads only the **canonical seed cast**
  (`origin_campaign_id IS NULL`); promoted-from-campaign NPCs no longer flood other
  players. A campaign sees the seed constants + its OWN generated NPCs (folded from
  `campaign_runtime.npcs`).
- `lib/state.ts` `persistSession` — the runtime NPC filter now gates on **provenance**
  (`!originCampaignId || originCampaignId === campaignId`), so a foreign NPC can't be
  re-persisted into this campaign's runtime and accrete. Existing bloat sheds on the
  next save.
- `llm/runtimeNarrative.ts` `registerNpc` — **never registers the player's own
  character** as an NPC (exact or first-name match against any PC/crew name); returns
  `""` and `markPresent` no-ops on it. Kills the "another NPC called Wren" dupe across
  every registration path (model declaration, dialogue backstop, scene analyst).

Effect for existing campaigns: post-deploy, a flooded cast (like Wren's 36) collapses
to the seed constants + the player's own NPCs; the accreted foreign entries drop from
`runtime.npcs` on the first turn taken after deploy. A one-time data cleanup can make
even the first turn clean (safe only AFTER the code deploys — the old universe-wide
load re-floods otherwise).

## Phase 2 — the constants build (TODO)

Places + loot are designed in detail in **LOCATIONS.md** (tiered canonical locations,
persisted procedural SITES with loot tables, risk/reward tiers). The NPC items below
stay here.

- **NPC roster bounding + dedup.** Token-containment dedup ("Yuri" ⊆ "Dockmaster Yuri")
  and near-dup handling ("Corso"/"Korso"); reject bare-role ("Guard") and mentioned-only
  registrations (only figures actually PRESENT become NPCs); a soft cap on a campaign's
  private cast. Stop promoting generated NPCs to the shared table (the shared cast stays
  the curated seed); prune the ~38 already-promoted rows.
- **Canonical locations.** The narrator's free-text `place` is scene flavor, but a place
  the player can RETURN to should resolve to a canonical location (or a stable
  sub-location of one) so it doesn't vanish. No inventing whole stations ad hoc.
- **Item constants.** Loot + cargo come from the catalog (ITEMS.md) and a defined cargo
  set (QUESTS.md `CARGO`), never a narrator-conjured "data core". The engine already
  drops illegitimate `items` gains; extend the same discipline to narrated cargo.
- **Admin curation.** A surface to view/prune the universe seed cast + promoted rows,
  so the constants stay hand-tended.
