"use client";

import type { CampaignState, Skill } from "@/shared/schemas";
import { tickMax } from "@/engine/progression";
import skillsMeta from "@/content/skills.json";
import { Bar, SheetSection, cap, fmtMod, sigLine } from "./ui";

const ATTR_ORDER = ["might", "reflex", "vitality", "intellect", "perception", "presence"] as const;

/** What each attribute governs — surfaced as a tooltip on the attribute chips. */
const ATTR_HINT: Record<(typeof ATTR_ORDER)[number], string> = {
  might: "Raw physical force — melee, hauling, breaking through.",
  reflex: "Speed and coordination — piloting, gunnery, small arms, dodging.",
  vitality: "Toughness and endurance — your HP and resisting harm.",
  intellect: "Reasoning and know-how — mechanics, electronics, navigation.",
  perception: "Awareness — spotting trouble, tracking, sensors.",
  presence: "Force of personality — negotiation, deception, intimidation.",
};

/** A signature's passive bonus to a given attribute (0 if none). This is applied
 *  at roll time (rolls.passiveBonus); the sheet shows the ADJUSTED total so what
 *  you see matches what you roll. */
function sigAttrBonus(pc: CampaignState["characters"][number], attr: string): number {
  const u = pc.uniqueSkill;
  if (u?.kind === "passive" && u.passiveTargetType === "attribute" && u.passiveTarget === attr) {
    return u.passiveAmount ?? 0;
  }
  return 0;
}

/** Every skill in the game, merged with the character's levels (0 if unlearned),
 *  learned first — so the sheet shows the full range the player can attempt, not
 *  just what they've trained. */
function allSkillRows(owned: Skill[]): Skill[] {
  const bySkill = new Map(owned.map((s) => [s.name, s]));
  return Object.keys(skillsMeta.skills)
    .map((name) => bySkill.get(name) ?? { name, level: 0, ticks: 0 })
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
}

/** Tooltip text for a skill: what it covers + its governing attribute
 *  (descriptions come from content/skills.json — the same source fed to the AI). */
function skillTooltip(name: string): string {
  const def = skillsMeta.skills[name as keyof typeof skillsMeta.skills] as
    | { attribute?: string; does?: string }
    | undefined;
  const a = (def?.attribute ?? "reflex").replace(/^./, (c) => c.toUpperCase());
  return def?.does ? `${def.does} (governed by ${a})` : `Governed by ${a}.`;
}

/** camelCase skill ids → readable labels ("smallArms" → "Small Arms", "zeroG" → "Zero-G"). */
function humanizeSkill(name: string): string {
  const special: Record<string, string> = { zeroG: "Zero-G", smallArms: "Small Arms" };
  if (special[name]) return special[name];
  const spaced = name.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** TRAITS tab — attributes, skills, and who the character is. */
export function TraitsTab({ state }: { state: CampaignState }) {
  const pc = state.characters.find((c) => c.kind === "pc");
  if (!pc) return <p className="text-neutral-500">No character.</p>;
  return (
    <div className="rounded border border-edge p-2">
      <div className="font-semibold text-neutral-100">{pc.name}</div>

      <SheetSection label="Attributes">
        <div className="grid grid-cols-6 gap-1">
          {ATTR_ORDER.map((a) => {
            const base = pc.attributes[a] ?? 0;
            const bonus = sigAttrBonus(pc, a);
            const total = base + bonus;
            return (
              <div
                key={a}
                className="cursor-help rounded border border-edge/60 bg-ink/40 px-1 py-1 text-center"
                title={
                  bonus
                    ? `${cap(a)} — ${ATTR_HINT[a]} (base ${fmtMod(base)} ${bonus >= 0 ? "+" : ""}${bonus} signature)`
                    : `${cap(a)} — ${ATTR_HINT[a]}`
                }
              >
                <div className="text-[9px] uppercase text-neutral-600">{a.slice(0, 3)}</div>
                <div className={"text-[13px] font-semibold " + (bonus ? "text-accent" : "text-neutral-100")}>
                  {fmtMod(total)}
                </div>
              </div>
            );
          })}
        </div>
      </SheetSection>

      <SheetSection label="Skills — improve max once per skill per scene">
        <div className="space-y-2">
          {allSkillRows(pc.skills).map((s) => {
            const learned = s.level > 0 || s.ticks > 0;
            return (
              <div key={s.name} className={learned ? "" : "opacity-45"}>
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="cursor-help text-[13px] text-neutral-200 underline decoration-dotted decoration-neutral-600 underline-offset-2"
                    title={skillTooltip(s.name)}
                  >
                    {humanizeSkill(s.name)}
                  </span>
                  <span className="shrink-0 tabular-nums text-[11px] text-neutral-500">
                    Level&nbsp;{s.level}
                    {learned && <span className="text-neutral-600"> · {s.ticks}/{tickMax(s.level)}</span>}
                  </span>
                </div>
                {learned && (
                  <div className="mt-1">
                    <Bar value={s.ticks} max={tickMax(s.level)} height="h-1" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetSection>

      {pc.uniqueSkill && (
        <SheetSection label="Signature">
          <p className="text-[13px] text-neutral-200">
            <span className="font-semibold">{pc.uniqueSkill.name}</span>
            <span className="text-accent/80"> · {sigLine(pc.uniqueSkill)}</span>
          </p>
        </SheetSection>
      )}
    </div>
  );
}
