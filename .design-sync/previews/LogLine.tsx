import { LogLine } from "@drift/ui";

/** A stretch of the dice log — mechanical events, newest on top. */
export const DiceLog = () => (
  <div className="w-72 space-y-1 bg-ink p-2">
    <LogLine icon="🎲" highlight>piloting 2d6+3 = 11 vs 9 — success</LogLine>
    <LogLine icon="🎯" highlight>mag-pistol +4 vs AC 13 — hit</LogLine>
    <LogLine icon="💥" highlight>damage 1d6+1 = 5 → Dockhand (2/7)</LogLine>
    <LogLine icon="▲">piloting tick 3/5</LogLine>
    <LogLine icon="⏱">Hollow Crown interest 4/6</LogLine>
    <LogLine icon="¢">dock fees −¢35</LogLine>
  </div>
);

export const Muted = () => (
  <div className="w-72 space-y-1 bg-ink p-2">
    <LogLine icon="🏴">Sable Chain rep +1</LogLine>
    <LogLine icon="•">stims restocked (2)</LogLine>
  </div>
);
