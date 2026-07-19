import type { PackStoryline } from "../types";

/**
 * SEASON ONE — "FAULT LINE" (HANDOFF_STORY_3.md). The Hollow Crown's founding
 * houses filed salvage claims on colony ships still in transit, then
 * engineered the "accident" their debt empire was built on. 3 acts, 9 played
 * chapters (ch-1..ch-8 shared spine + one of three fact-gated finales),
 * grounded entirely in existing canon (Kesh, the Wake, the Reclaimers'
 * suspicion). One neutral opener via the Ledger (canon "trusted by all
 * sides") rather than per-faction variants — deferred per STORY.md; the
 * trigger schema has no faction predicate.
 */
export const driftStoryline: PackStoryline = {
  chapters: [
    {
      id: "ch-1",
      act: 1,
      title: "The Mark on the Manifest",
      trigger: { tendaysAtLeast: 2 },
      castNpcIds: ["npc-ledger"],
      objectives: [
        { id: "o1", kind: "travel", summary: "Make for Rook Station.", locationId: "loc-rook" },
        { id: "o2", kind: "report", summary: "Meet the Ledger.", npcId: "npc-ledger" },
      ],
      beats: [
        {
          id: "b1",
          directive: "Word reaches the player, by reputation alone, that the Ledger — Rook's symbol-marked fixer — is asking for them by name.",
        },
        {
          id: "b2",
          directive: "Have the Ledger lay out the find plainly: a Wake salvage pod carries Hollow Crown claim-seals dated BEFORE the wreck it came from ever went down. They want it verified quietly, off every book.",
          fallbackDirective: "A sealed courier packet reaches the player instead, marked with the Ledger's own symbol: the same find laid out in writing — claim-seals dated before their own wreck. Whoever sent it wants it verified quietly, off every book.",
          aboutNpcId: "npc-ledger",
        },
      ],
      reward: { credits: 100 },
    },
    {
      id: "ch-2",
      act: 1,
      title: "Graveyard Shift",
      trigger: { requiresChapterId: "ch-1" },
      castNpcIds: ["npc-ismay"],
      objectives: [
        { id: "o1", kind: "travel", summary: "Reach the Wake.", locationId: "loc-wake" },
        { id: "o2", kind: "report", summary: "Report to Warden Ismay.", npcId: "npc-ismay" },
        { id: "o3", kind: "investigate", summary: "Pull the pod's provenance from the wreck logs", requiredSkills: ["perception", "electronics"] },
      ],
      beats: [
        {
          id: "b1",
          directive: "Set the Wake's mood: Ismay's rules for salvagers, strictly enforced — nothing leaves the field uncatalogued, and nobody works a berth she hasn't cleared.",
        },
        {
          id: "b2",
          directive: "Have Ismay's own ledgers come up wrong: the pod's berth-of-origin was scrubbed years ago, by someone with the authority to do it. She's too careful a warden to act surprised.",
          fallbackDirective: "The Wake's public archive shows the same gap: the pod's berth-of-origin scrubbed years ago, by someone with real authority. A junior clerk mentions Ismay used to ask about that exact pod, before she stopped.",
          aboutNpcId: "npc-ismay",
        },
        {
          id: "b3",
          directive: "A second skiff shadows the player's work at the wreck, running no transponder — gone the moment it's noticed.",
        },
      ],
      reward: { credits: 150 },
    },
    {
      id: "ch-3",
      act: 1,
      title: "What Kesh Knows",
      trigger: { requiresChapterId: "ch-2" },
      castNpcIds: ["npc-kesh"],
      objectives: [
        { id: "o1", kind: "report", summary: "Hear Kesh out.", npcId: "npc-kesh" },
        { id: "o2", kind: "persuade", summary: "Convince Kesh to open her archive", requiredSkills: ["negotiation", "diplomacy"] },
      ],
      beats: [
        {
          id: "b1",
          directive: "Have Kesh find the PLAYER, not the other way round — she's tracked that pod for years and wants to know exactly who else is pulling its thread.",
          fallbackDirective: "A message reaches the player through a Reclaimer relay: someone has been tracking that same pod for years and wants to know who else is pulling its thread. No name attached — only coordinates for a meet.",
          aboutNpcId: "npc-kesh",
        },
        {
          id: "b2",
          directive: "Lay out the case Kesh has built: charge patterns, milled detonator housings, claim dates that predate the wreck — deliberate sabotage, run under Crown-pattern seals.",
        },
        {
          id: "b3",
          directive: "Have Kesh admit why she sat on it: the hush money she took once, early, and what it's cost her every year since to keep that quiet.",
          fallbackDirective: "Kesh's own field notes, left with the archive, admit it in her hand: hush money taken once, early, and the cost of keeping it quiet every year since.",
          aboutNpcId: "npc-kesh",
        },
      ],
      reward: { credits: 200, factionRep: { factionId: "f-reclaimers", delta: 1 } },
    },
    {
      id: "ch-4",
      act: 2,
      title: "The Handler's Price",
      trigger: { requiresChapterId: "ch-3" },
      castNpcIds: ["npc-ilyana"],
      objectives: [
        { id: "o1", kind: "travel", summary: "Return to Meridian Ring.", locationId: "loc-meridian" },
        { id: "o2", kind: "report", summary: "Report to Ilyana.", npcId: "npc-ilyana" },
      ],
      beats: [
        {
          id: "b1",
          directive: "The summons arrives: the Hollow Crown has noticed the player's trip to the Wake, and wants an accounting.",
        },
        {
          id: "b2",
          directive: "Have Ilyana's questions run wrong for a debt handler — she asks what was IN the wreck logs, not what the player was doing out there.",
          fallbackDirective: "The Crown's summons itself asks the wrong question for a routine debt matter — not what the player was doing at the Wake, but what was IN the logs they pulled.",
          aboutNpcId: "npc-ilyana",
        },
        {
          id: "b3",
          directive: "Pressed, have Ilyana let one thing slip: she flagged a manifest discrepancy herself once, six years back, and has spent every year since paying for it.",
          fallbackDirective: "A collections-floor rumor reaches the player instead: Ilyana flagged a manifest discrepancy once, six years back, and was quietly moved off the desk that mattered for it.",
          aboutNpcId: "npc-ilyana",
        },
      ],
      choicePoint: {
        id: "c1",
        prompt: "What do you give the Crown's handler?",
        options: [
          { id: "confide", label: "Tell Ilyana what you found", fact: "faultline-confided-ilyana" },
          { id: "stonewall", label: "Give the Crown nothing", fact: "faultline-stonewalled-crown" },
        ],
      },
      reward: { credits: 200 },
    },
    {
      id: "ch-5",
      act: 2,
      title: "Milled at Cinderhaul",
      trigger: { requiresChapterId: "ch-4" },
      castNpcIds: ["npc-osk"],
      objectives: [
        { id: "o1", kind: "travel", summary: "Reach Cinderhaul.", locationId: "loc-cinder" },
        { id: "o2", kind: "report", summary: "Find Foreman Osk.", npcId: "npc-osk" },
        { id: "o3", kind: "investigate", summary: "Trace the detonator housings to their work order", requiredSkills: ["mechanics", "streetwise"] },
      ],
      beats: [
        {
          id: "b1",
          directive: "The detonator housings carry a Cinderhaul guild-stamp; the trail runs straight through the dock floor.",
        },
        {
          id: "b2",
          directive: "Have Osk recognize the work himself: his own apprentice-mark is milled inside the housing — a job specced to him blind as lane clearance, a lifetime ago.",
          fallbackDirective: "The dock floor's own apprentice records show the mark: Osk's, from a job specced blind as lane clearance, a lifetime ago. He's gone quiet the moment the records come up.",
          aboutNpcId: "npc-osk",
        },
        {
          id: "b3",
          directive: "Someone has been buying up and quietly burning the old work-order archives all year — the player's copy may be the last one left.",
        },
      ],
      reward: { credits: 250 },
    },
    {
      id: "ch-6",
      act: 2,
      title: "The Quartermaster's Offer",
      trigger: { requiresChapterId: "ch-5" },
      castNpcIds: ["npc-brekk"],
      objectives: [
        { id: "o1", kind: "travel", summary: "Reach Coldharbor.", locationId: "loc-sable" },
        { id: "o2", kind: "report", summary: "Meet Quartermaster Brekk.", npcId: "npc-brekk" },
        { id: "o3", kind: "persuade", summary: "Refuse the Chain's terms without starting a war", requiredSkills: ["negotiation", "streetwise"] },
      ],
      beats: [
        {
          id: "b1",
          directive: "Coldharbor at full strength: the pitch is triple pay and Chain \"handling\" of whatever the Crown does in response — for the whole case, not a cut of it.",
        },
        {
          id: "b2",
          directive: "Give away the tell yourself through Brekk: no Chain seal anywhere on the offer — personal guard, not station troops. This is his own play, not Coldharbor's.",
          fallbackDirective: "The offer itself carries no Chain seal anywhere — personal guard, not station troops. Whoever's behind it is playing alone, whether or not Brekk answers for it in person.",
          aboutNpcId: "npc-brekk",
        },
        {
          id: "b3",
          directive: "Leaving Coldharbor, a Crown fast-packet sits on the docks. Both sides now know exactly who's holding the thread.",
        },
      ],
      reward: { credits: 300 },
    },
    {
      id: "ch-7",
      act: 3,
      title: "Verity's Last Run",
      trigger: { requiresChapterId: "ch-6" },
      castNpcIds: ["npc-kesh"],
      objectives: [
        { id: "o1", kind: "travel", summary: "Reach the Verity's wreck in the Shear.", locationId: "loc-shear" },
        { id: "o2", kind: "investigate", summary: "Cut the flight recorder core out of the Verity's spine", requiredSkills: ["electronics", "perception"] },
        { id: "o3", kind: "report", summary: "Bring the recorder to Kesh.", npcId: "npc-kesh" },
      ],
      beats: [
        {
          id: "b1",
          directive: "The Verity's hulk fills the Shear: the graveyard's founding wound, still radiating heat under the dark.",
        },
        {
          id: "b2",
          directive: "Have Kesh match the recovered recorder against her own archive: course orders diverting the convoy INTO the Shear, sealed under a Crown founding-house cipher.",
          fallbackDirective: "The recorder matches against the Reclaimer archive on file: course orders diverting the convoy into the Shear, sealed under a Crown founding-house cipher. Kesh isn't there to see it confirmed.",
          aboutNpcId: "npc-kesh",
        },
        {
          id: "b3",
          directive: "Have Kesh hand the player custody of the entire case — her name stays off it. Whoever holds it now decides what the Drift becomes.",
          fallbackDirective: "A sealed transfer reaches the player: custody of the entire case, Kesh's name scrubbed from every file. Whoever holds it now decides what the Drift becomes.",
          aboutNpcId: "npc-kesh",
        },
      ],
      reward: { credits: 350, crewUnlock: "npc-kesh" },
    },
    {
      id: "ch-8",
      act: 3,
      title: "Where It Breaks",
      trigger: { requiresChapterId: "ch-7" },
      castNpcIds: ["npc-quist", "npc-ledger"],
      objectives: [
        { id: "o1", kind: "travel", summary: "Reach Halcyon.", locationId: "loc-freeport" },
        { id: "o2", kind: "report", summary: "Find Harbormaster Quist.", npcId: "npc-quist" },
      ],
      beats: [
        {
          id: "b1",
          directive: "Halcyon under real strain: Crown and Chain packets both sitting in dock, Quist enforcing neutrality at gunpoint.",
        },
        {
          id: "b2",
          directive: "Have Quist give it to the player straight: choose, and choose now — an undecided holder of something this size is everyone's target.",
          fallbackDirective: "Word from Quist's own harbor office reaches the player secondhand: choose, and choose now. An undecided holder of something this size is everyone's target.",
          aboutNpcId: "npc-quist",
        },
        {
          id: "b3",
          directive: "Have the Ledger arrive with the last piece: survivor-debt ledgers tying the Crown's oldest accounts directly to Verity families.",
          fallbackDirective: "The last piece arrives anyway, courier-sealed with the Ledger's own symbol: survivor-debt ledgers tying the Crown's oldest accounts directly to Verity families.",
          aboutNpcId: "npc-ledger",
        },
      ],
      choicePoint: {
        id: "c1",
        prompt: "The proof of the Verity sabotage — where does it land?",
        options: [
          { id: "chain", label: "Arm the Sable Chain with it", fact: "faultline-armed-the-chain" },
          { id: "crown", label: "Sell the Crown its silence", fact: "faultline-buried-with-crown" },
          { id: "open", label: "Broadcast it to the whole Drift", fact: "faultline-broadcast-open" },
        ],
      },
      reward: { credits: 400 },
    },
    {
      id: "ch-9a",
      act: 3,
      title: "Fault Line: The New Chain",
      trigger: { requiresChapterId: "ch-8", hasFact: "faultline-armed-the-chain" },
      castNpcIds: ["npc-brekk"],
      objectives: [
        { id: "o1", kind: "travel", summary: "Return to Coldharbor.", locationId: "loc-sable" },
        { id: "o2", kind: "report", summary: "Find Brekk.", npcId: "npc-brekk" },
        { id: "o3", kind: "eliminate", summary: "Break the Crown's answer at Coldharbor", enemyTier: "T2" },
      ],
      beats: [
        {
          id: "b1",
          directive: "The proof lands like a detonation: the Sable Chain moves openly on the lanes, no longer pretending otherwise.",
        },
        {
          id: "b2",
          directive: "Have Brekk react vindicated and terrified in the same breath: his off-book play just became Chain doctrine, and the player is the one who made it happen.",
          fallbackDirective: "Word from Coldharbor's staging docks: Brekk's off-book play just became open Chain doctrine. He isn't answering hails — vindicated or terrified, nobody's sure which.",
          aboutNpcId: "npc-brekk",
        },
        {
          id: "b3",
          directive: "The Crown's reprisal arrives at Coldharbor's approach. The season ends in that fight.",
        },
      ],
      reward: { credits: 600, factionRep: { factionId: "f-sable", delta: 2 }, itemId: "combatArmor" },
    },
    {
      id: "ch-9b",
      act: 3,
      title: "Fault Line: The Quiet Ledger",
      trigger: { requiresChapterId: "ch-8", hasFact: "faultline-buried-with-crown" },
      castNpcIds: ["npc-ilyana"],
      objectives: [
        { id: "o1", kind: "travel", summary: "Return to Meridian Ring.", locationId: "loc-meridian" },
        { id: "o2", kind: "report", summary: "Meet Ilyana.", npcId: "npc-ilyana" },
        { id: "o3", kind: "persuade", summary: "Set the terms of the Crown's silence", requiredSkills: ["negotiation", "diplomacy"] },
      ],
      beats: [
        {
          id: "b1",
          directive: "The Crown pays best for what never happened. The negotiation itself is the real battlefield.",
        },
        {
          id: "b2",
          directive: "Have Ilyana learn, mid-negotiation, that her own six-year-old flag was THIS — and watch her own house bury it a second time, in front of her.",
          fallbackDirective: "A note reaches the player after the terms are set: Ilyana has learned her own six-year-old flag was this, and watched her own house bury it a second time.",
          aboutNpcId: "npc-ilyana",
        },
        {
          id: "b3",
          directive: "The season closes on the weight of the price paid: the Drift stays the Crown's, and the player is owed by the house that owns everything.",
        },
      ],
      reward: { credits: 800, factionRep: { factionId: "f-crown", delta: 2 }, itemId: "poweredCarapace" },
    },
    {
      id: "ch-9c",
      act: 3,
      title: "Fault Line: Open Sky",
      trigger: { requiresChapterId: "ch-8", hasFact: "faultline-broadcast-open" },
      castNpcIds: ["npc-ledger"],
      objectives: [
        { id: "o1", kind: "travel", summary: "Return to Rook Station.", locationId: "loc-rook" },
        { id: "o2", kind: "report", summary: "Find the Ledger.", npcId: "npc-ledger" },
        { id: "o3", kind: "investigate", summary: "Get the broadcast out through Rook's relays ahead of the jammers", requiredSkills: ["electronics", "streetwise"] },
      ],
      beats: [
        {
          id: "b1",
          directive: "The race to transmit: every relay between Rook and the wider Drift is suddenly, violently contested.",
        },
        {
          id: "b2",
          directive: "Have the Ledger unmask at the transmitter itself: the symbol, the Verity's registry, the family name underneath it all — this was always theirs to finish.",
          fallbackDirective: "The transmission carries the Ledger's unmasking anyway, recorded and broadcast alongside the proof: the symbol, the Verity's registry, the family name underneath it all.",
          aboutNpcId: "npc-ledger",
        },
        {
          id: "b3",
          directive: "The truth lands everywhere at once. No side owns the player now, and every side knows their name.",
        },
      ],
      reward: { credits: 400, factionRep: { factionId: "f-free", delta: 2 }, itemId: "sealedHardsuit" },
    },
  ],
};
