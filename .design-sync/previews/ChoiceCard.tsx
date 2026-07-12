import { ChoiceCard } from "@drift/ui";

/** Faction pick — one selected, one at rest. */
export const FactionPick = () => (
  <div className="max-w-xl space-y-3">
    <ChoiceCard
      title="The Sable Chain"
      meta="the rising knife"
      description="Muscle with ambitions. They pay fast, forgive nothing, and remember everything."
      selected
    >
      <p className="mt-2 text-xs text-accent/80">Playstyle: aggression rewarded, loyalty tested</p>
    </ChoiceCard>
    <ChoiceCard
      title="Meridian Commerce"
      meta="legitimate business in an illegitimate age"
      description="Contracts, cargo, and clean paper. The safest way in — and the slowest way up."
    >
      <p className="mt-2 text-xs text-accent/80">Playstyle: leverage and margins over gunfire</p>
    </ChoiceCard>
  </div>
);

export const OptionGrid = () => (
  <div className="grid max-w-xl gap-2 sm:grid-cols-2">
    <ChoiceCard title="Commerce" description="Deals, cargo, and coin. You win with leverage and a good margin." />
    <ChoiceCard title="Combat" description="Guns and gunnery. When talk fails, you're already moving." selected />
    <ChoiceCard title="Intrigue" description="Shadows, secrets, and systems. You'd rather never be seen." />
    <ChoiceCard title="Piloting" description="The cockpit is where the world slows down. You fly like breathing." />
  </div>
);

export const Disabled = () => (
  <div className="max-w-sm">
    <ChoiceCard title="The Undertow" description="Debts collected, one way or another. (Locked until Season 2.)" disabled />
  </div>
);
