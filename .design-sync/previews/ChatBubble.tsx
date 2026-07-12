import { ChatBubble } from "@drift/ui";

/** A stretch of play — narrator prose, player action, system notice. */
export const Transcript = () => (
  <div className="max-w-2xl space-y-5">
    <ChatBubble role="dm">
      The dock lights gutter as you slip the clamps. Somewhere aft, a Hollow
      Crown collector is still arguing with the harbormaster about your berth
      fees — which means you have about ninety seconds of nobody watching the
      departure lanes.
    </ChatBubble>
    <ChatBubble role="player">I cut thrust and drift past the checkpoint, running dark.</ChatBubble>
    <ChatBubble role="system">— scene ended · checklist applied —</ChatBubble>
  </div>
);

export const Recap = () => (
  <div className="max-w-2xl">
    <ChatBubble role="recap">
      {"Previously: you owe the Hollow Crown ¢1,400 and the interest compounds at dawn.\nThe Sable Chain offered you a way out — one run, no questions.\nYour ship is the Vessel Argent, hull at 9/14, shield spent."}
    </ChatBubble>
  </div>
);

export const NarratorProse = () => (
  <div className="max-w-2xl">
    <ChatBubble role="dm">
      Meridian Dock never sleeps; it just changes shifts. The night crowd is
      thinner and meaner, and the woman waiting at your airlock wears Undertow
      grey like she was born in it. "Debts collected," she says, almost kindly.
      "One way or another."
    </ChatBubble>
  </div>
);
