"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { worldIntro, seasonOneSpine, factionBriefs } from "@/content/briefs";
import { backgrounds, alignments, ambitions } from "@/content/creation";
import { openingFor } from "@/content/openings";
import {
  suggestName,
  sample,
  exampleSkills,
  exampleMoralCodes,
  exampleLosses,
  exampleTies,
  exampleTells,
} from "@/content/examples";

/** How many example cards / flavor chips to surface at once (reshuffle for more). */
const GALLERY_COUNT = 6;
const CHIP_COUNT = 4;
import type { CreationInput } from "@/shared/multiplayer";
import type { Character, UniqueSkill, AttributeKey } from "@/shared/schemas";

/** Advisory note from the AI finalize pass (shape mirrors llm/creationFinalize). */
interface CreationNote {
  field: "name" | "moralCode" | "uniqueSkill";
  severity: "ok" | "warn";
  message: string;
  suggestion?: string;
}
interface CreateResult {
  campaignId: string;
  characterId: string;
  character: Character;
  notes: CreationNote[];
  /** True while the AI flesh-out (backstory/voice/opening) is still running in
   *  the background; the review screen polls for it. */
  enriching?: boolean;
}

const BIASES = [
  { id: "commerce", label: "Commerce", description: "Deals, cargo, and coin. You win with leverage and a good margin." },
  { id: "combat", label: "Combat", description: "Guns and gunnery. When talk fails, you're already moving." },
  { id: "intrigue", label: "Intrigue", description: "Shadows, secrets, and systems. You'd rather never be seen." },
  { id: "piloting", label: "Piloting", description: "The cockpit is where the world slows down. You fly like breathing." },
  { id: "diplomacy", label: "Diplomacy", description: "Words as weapons. You move people, not just cargo." },
] as const;

const SKILL_OPTIONS = [
  "piloting", "gunnery", "smallArms", "melee", "stealth", "streetwise",
  "negotiation", "deception", "intimidation", "mechanics", "electronics",
  "navigation", "zeroG", "survival",
];
const ATTR_OPTIONS = ["might", "reflex", "vitality", "intellect", "perception", "presence"];
const ATTR_ORDER: AttributeKey[] = ["might", "reflex", "vitality", "intellect", "perception", "presence"];

type Kind = "passive" | "trigger";

/** True when two signatures are identical. Used so a gallery preset stays
 *  highlighted only while it's unedited — any tweak falls back to "Custom". */
function skillsEqual(a: UniqueSkill, b: UniqueSkill): boolean {
  if (a.kind !== b.kind || a.name !== b.name || a.description !== b.description) return false;
  if (a.kind === "passive" && b.kind === "passive") {
    return (
      a.passiveTargetType === b.passiveTargetType &&
      a.passiveTarget === b.passiveTarget &&
      a.passiveAmount === b.passiveAmount
    );
  }
  if (a.kind === "trigger" && b.kind === "trigger") {
    return a.triggerScenario === b.triggerScenario && a.usesPerScene === b.usesPerScene;
  }
  return false;
}

export default function CreateWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  // Reshuffle seed for the signature-skill gallery (bump → new random picks).
  const [skillSeed, setSkillSeed] = useState(0);
  const shownSkills = useMemo(() => sample(exampleSkills, GALLERY_COUNT, skillSeed), [skillSeed]);

  // Every step change starts a fresh screen — jump back to the top so long
  // pages (faction list, questionnaire) don't open scrolled halfway down.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  // Set when the API rejects a second character (one-per-player): links back to it.
  const [existingCampaignId, setExistingCampaignId] = useState<string | null>(null);

  // Poll for the background AI flesh-out (see /api/create): once the review
  // screen is up, swap the templated backstory/voice for the personalized ones
  // as soon as they land. The player can hit "Enter" at any time regardless.
  useEffect(() => {
    if (step !== 5 || !result?.enriching) return;
    const campaignId = result.campaignId;
    const baseBackstory = result.character.backstory ?? "";
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      try {
        const r = await fetch(`/api/create/enrichment?campaignId=${campaignId}`);
        const d = await r.json();
        if (d.ready && d.backstory && d.backstory !== baseBackstory) {
          setResult((prev) =>
            prev
              ? {
                  ...prev,
                  enriching: false,
                  character: {
                    ...prev.character,
                    backstory: d.backstory,
                    voiceNotes: d.voiceNotes || prev.character.voiceNotes,
                    moralCode: d.moralCode || prev.character.moralCode,
                  },
                }
              : prev,
          );
          clearInterval(id);
        }
      } catch {
        /* transient; keep polling until the ceiling */
      }
      if (tries >= 10) clearInterval(id); // ~18s ceiling, then keep the templated copy
    }, 1800);
    return () => clearInterval(id);
  }, [step, result?.enriching, result?.campaignId, result?.character.backstory]);

  // form state
  const [name, setName] = useState("");
  const [factionId, setFactionId] = useState("");
  const [bias, setBias] = useState("");
  const [alignment, setAlignment] = useState("");
  const [background, setBackground] = useState("");
  const [ambition, setAmbition] = useState("");
  // Optional flavor — blank fields are auto-generated at finalize.
  const [moralCode, setMoralCode] = useState("");
  const [loss, setLoss] = useState("");
  const [tie, setTie] = useState("");
  const [tell, setTell] = useState("");

  // Start with a suggested canon name so the field is never blank. Client-only
  // (in an effect) to avoid an SSR hydration mismatch from the random pick.
  useEffect(() => {
    setName((n) => n || suggestName(Math.random()));
  }, []);

  // unique skill
  const [usName, setUsName] = useState("");
  const [usDesc, setUsDesc] = useState("");
  const [usKind, setUsKind] = useState<Kind>("passive");
  const [pTargetType, setPTargetType] = useState<"skill" | "attribute">("skill");
  const [pTarget, setPTarget] = useState("piloting");
  const [pAmount, setPAmount] = useState(1);
  const [tScenario, setTScenario] = useState("");
  const [tUses, setTUses] = useState(1);

  const amountCap = pTargetType === "attribute" ? 1 : 2;

  const uniqueSkill = useMemo(() => {
    if (usKind === "passive") {
      return {
        name: usName, description: usDesc, kind: "passive" as const,
        passiveTargetType: pTargetType, passiveTarget: pTarget,
        passiveAmount: Math.min(pAmount, amountCap), usesPerScene: 1,
      };
    }
    return {
      name: usName, description: usDesc, kind: "trigger" as const,
      triggerScenario: tScenario, triggerEffect: "auto_crit" as const, usesPerScene: tUses,
    };
  }, [usKind, usName, usDesc, pTargetType, pTarget, pAmount, amountCap, tScenario, tUses]);

  // Which preset (if any) the builder currently matches exactly. Edit anything
  // and this goes undefined → the gallery deselects and we show "Custom".
  const matchedPreset = useMemo(
    () => exampleSkills.find((ex) => skillsEqual(ex.skill, uniqueSkill)),
    [uniqueSkill],
  );
  const isCustom = Boolean(usName || usDesc || tScenario) && !matchedPreset;

  const canFinish =
    name && factionId && bias && alignment && background && ambition &&
    usName && usDesc && (usKind === "passive" ? pTarget : tScenario);

  /** Pull an example signature into the builder to tweak. */
  function applyExample(ex: UniqueSkill) {
    setUsName(ex.name);
    setUsDesc(ex.description);
    setUsKind(ex.kind);
    if (ex.kind === "passive") {
      setPTargetType(ex.passiveTargetType ?? "skill");
      setPTarget(ex.passiveTarget ?? "piloting");
      setPAmount(ex.passiveAmount ?? 1);
    } else {
      setTScenario(ex.triggerScenario ?? "");
      setTUses(ex.usesPerScene);
    }
  }

  async function submitCreation(payload: CreationInput) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) {
        setErr(data.error);
        if (data.existingCampaignId) setExistingCampaignId(data.existingCampaignId);
      } else {
        setResult(data as CreateResult);
        setDismissed([]);
        setStep(5);
      }
    } catch {
      setErr("Failed to create character.");
    } finally {
      setBusy(false);
    }
  }

  function create(overrideName?: string) {
    return submitCreation({
      name: overrideName ?? name,
      parentFactionId: factionId,
      bias: bias as CreationInput["bias"],
      alignment: alignment as CreationInput["alignment"],
      background,
      ambition,
      flavor: {
        moralCode: moralCode || undefined,
        loss: loss || undefined,
        tie: tie || undefined,
        tell: tell || undefined,
      },
      uniqueSkill,
    });
  }

  /** Roll a complete random character and jump straight to the review screen. */
  function quickCreate() {
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
    const nm = suggestName(Math.random());
    const fac = pick(factionBriefs).factionId;
    const bi = pick(BIASES).id;
    const al = pick(alignments).id;
    const bg = pick(backgrounds).id;
    const am = pick(ambitions).id;
    const ex = pick(exampleSkills).skill;
    // Reflect the roll in the form so "← back" shows real choices.
    setName(nm);
    setFactionId(fac);
    setBias(bi);
    setAlignment(al);
    setBackground(bg);
    setAmbition(am);
    applyExample(ex);
    // Flavor left blank on purpose — the finalize pass invents it.
    setMoralCode("");
    setLoss("");
    setTie("");
    setTell("");
    return submitCreation({
      name: nm,
      parentFactionId: fac,
      bias: bi as CreationInput["bias"],
      alignment: al as CreationInput["alignment"],
      background: bg,
      ambition: am,
      flavor: {},
      uniqueSkill: ex,
    });
  }

  /** Accept a suggested canon name: update the form and regenerate. */
  function acceptName(newName: string) {
    setName(newName);
    create(newName);
  }

  const steps = ["The world", "Your faction", "Who you are", "Your signature", "Review", "Meet"];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      {/* progress — compact "Step N of M" on mobile, full breadcrumb on ≥sm */}
      <div className="mb-6 text-xs text-neutral-500 sm:hidden">
        Step {Math.min(step + 1, steps.length)} of {steps.length} ·{" "}
        <span className="font-semibold text-accent">{steps[step]}</span>
      </div>
      <div className="mb-8 hidden flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500 sm:flex">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={i === step ? "font-semibold text-accent" : i < step ? "text-good" : ""}>{s}</span>
            {i < steps.length - 1 && <span className="text-edge">→</span>}
          </div>
        ))}
      </div>

      {/* One-per-player rejection (e.g. two tabs racing): offer the existing one. */}
      {existingCampaignId && (
        <div className="mb-6 rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm">
          <p className="text-accent">⚠ {err || "You already have a character."}</p>
          <button
            onClick={() => router.push(`/play/${existingCampaignId}`)}
            className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink"
          >
            Go to your character →
          </button>
        </div>
      )}

      {/* Step 0 — world */}
      {step === 0 && (
        <Section>
          <h1 className="mb-4 text-3xl font-bold text-accent">DRIFT</h1>
          <Prose text={worldIntro} highlight={FACTION_TERMS} />
          <div className="my-6 rounded-lg border border-edge bg-panel/50 p-4">
            <Prose text={seasonOneSpine} />
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button onClick={() => setStep(1)} className="rounded-lg bg-accent px-6 py-3 font-semibold text-ink">
              Enter the lanes →
            </button>
            <button
              onClick={quickCreate}
              disabled={busy}
              className="rounded-lg border border-edge px-5 py-3 font-semibold text-neutral-200 hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {busy ? "Rolling…" : "⚡ Quick create"}
            </button>
          </div>
          <p className="mt-2 text-xs text-neutral-500">Quick create rolls a full random character — you can review and tweak before entering.</p>
        </Section>
      )}

      {/* Step 1 — faction */}
      {step === 1 && (
        <Section>
          <H>Where do you start?</H>
          <p className="mb-5 text-neutral-400">Every character begins embedded in a faction. The story will offer a chance to break away and build your own — but this is your first allegiance.</p>
          <div className="space-y-3">
            {factionBriefs.map((f) => (
              <button
                key={f.factionId}
                onClick={() => setFactionId(f.factionId)}
                className={
                  "block w-full rounded-lg border p-4 text-left transition " +
                  (factionId === f.factionId ? "border-accent bg-panel" : "border-edge hover:border-neutral-600")
                }
              >
                <div className="flex items-start gap-3">
                  <FactionEmblem factionId={f.factionId} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-lg font-semibold">{f.name}</span>
                      <span className="shrink-0 text-xs italic text-neutral-500">{f.tagline}</span>
                    </div>
                    <p className="mt-1 text-sm text-neutral-400">{f.brief}</p>
                    <p className="mt-2 text-xs text-accent/80">Playstyle: {f.playstyle}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <Nav back={() => setStep(0)} next={factionId ? () => setStep(2) : undefined} />
        </Section>
      )}

      {/* Step 2 — questionnaire */}
      {step === 2 && (
        <Section>
          <H>Who are you?</H>
          <Field label="Name">
            <div className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="A name the lanes would use — e.g. Silas Corr" />
              <button
                type="button"
                onClick={() => setName(suggestName(Math.random()))}
                className="shrink-0 rounded-md border border-edge px-3 py-2 text-sm text-neutral-300 hover:border-accent hover:text-accent"
                title="Suggest a canon name"
              >
                Suggest ⟳
              </button>
            </div>
          </Field>

          <Field label="Background — where you came from">
            <Choices options={backgrounds.map((b) => ({ id: b.id, label: b.label, description: b.hook }))} value={background} onPick={setBackground} />
          </Field>

          <Field label="Focus — what you're good at">
            <Choices options={BIASES.map((b) => ({ id: b.id, label: b.label, description: b.description }))} value={bias} onPick={setBias} />
          </Field>

          <Field label="Code — how you carry yourself">
            <Choices options={alignments} value={alignment} onPick={setAlignment} />
          </Field>

          <Field label="Ambition — what you're really after">
            <Choices options={ambitions} value={ambition} onPick={setAmbition} />
          </Field>

          <div className="mt-6 border-t border-edge pt-5">
            <div className="mb-1 text-sm font-semibold text-neutral-200">
              Flavor &amp; depth <span className="font-normal text-neutral-500">— optional</span>
            </div>
            <p className="mb-4 text-xs text-neutral-500">
              Leave any of these blank and the lanes will invent them, woven into your backstory.
            </p>
            <FlavorField label="The line you won't cross" value={moralCode} onChange={setMoralCode} placeholder="e.g. people aren't cargo" examples={exampleMoralCodes} />
            <FlavorField label="A loss or scar" value={loss} onChange={setLoss} placeholder="what did it cost you?" examples={exampleLosses} />
            <FlavorField label="A debt or tie" value={tie} onChange={setTie} placeholder="who do you owe — or who owes you?" examples={exampleTies} />
            <FlavorField label="A tell" value={tell} onChange={setTell} placeholder="a habit that gives you away" examples={exampleTells} />
          </div>

          <Nav back={() => setStep(1)} next={name && background && bias && alignment && ambition ? () => setStep(3) : undefined} />
        </Section>
      )}

      {/* Step 3 — unique skill */}
      {step === 3 && (
        <Section>
          <H>Your signature</H>
          <p className="mb-4 text-neutral-400">One thing that makes you unlike anyone else in the lanes. Pull from an example, or build your own.</p>

          {/* example gallery */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-neutral-500">For inspiration — click to use, then tweak</p>
              <button
                type="button"
                onClick={() => setSkillSeed((s) => s + 1)}
                className="shrink-0 text-xs text-neutral-400 hover:text-accent"
                title="Show a different set of examples"
              >
                ↻ more ideas
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {shownSkills.map((ex) => (
                <button
                  key={ex.skill.name}
                  type="button"
                  onClick={() => applyExample(ex.skill)}
                  className={
                    "rounded-lg border p-3 text-left transition " +
                    (skillsEqual(ex.skill, uniqueSkill) ? "border-accent bg-panel" : "border-edge hover:border-neutral-600")
                  }
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-neutral-100">{ex.skill.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-accent/70">{ex.skill.kind}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-400">{ex.blurb}</p>
                </button>
              ))}
            </div>
          </div>

          {/* divider: everything below is the custom builder, not more presets */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-edge" />
            <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-500">
              or build your own
              {isCustom && (
                <span className="rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                  Custom
                </span>
              )}
            </span>
            <div className="h-px flex-1 bg-edge" />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <KindCard active={usKind === "passive"} onClick={() => setUsKind("passive")} title="Passive effects" desc="A small, constant buff to something you do. Reliable." />
            <KindCard active={usKind === "trigger"} onClick={() => setUsKind("trigger")} title="Signature moment" desc="In one narrow situation you define, a roll lands as a natural 20. Rare, decisive." />
          </div>

          <Field label="Name it">
            <input value={usName} onChange={(e) => setUsName(e.target.value)} className={inputClass} placeholder="e.g. Deadhand, Ghost Sense, The Closer" />
          </Field>
          <Field label="Describe it">
            <input value={usDesc} onChange={(e) => setUsDesc(e.target.value)} className={inputClass} placeholder="A sentence of flavor" />
          </Field>

          {usKind === "passive" ? (
            <div className="rounded-lg border border-edge bg-panel/40 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Buff a">
                  <select value={pTargetType} onChange={(e) => { setPTargetType(e.target.value as "skill" | "attribute"); setPTarget(e.target.value === "skill" ? "piloting" : "reflex"); }} className={inputClass}>
                    <option value="skill">Skill</option>
                    <option value="attribute">Attribute (broader)</option>
                  </select>
                </Field>
                <Field label={pTargetType === "skill" ? "Which skill" : "Which attribute"}>
                  <select value={pTarget} onChange={(e) => setPTarget(e.target.value)} className={inputClass}>
                    {(pTargetType === "skill" ? SKILL_OPTIONS : ATTR_OPTIONS).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label={`Amount (max +${amountCap})`}>
                  <select value={Math.min(pAmount, amountCap)} onChange={(e) => setPAmount(Number(e.target.value))} className={inputClass}>
                    {Array.from({ length: amountCap }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>+{n}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="mt-2 text-xs text-neutral-500">Attribute buffs help every skill under that attribute, so they cap at +1.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-edge bg-panel/40 p-4">
              <Field label="The scenario (be specific — the GM decides when it applies)">
                <input value={tScenario} onChange={(e) => setTScenario(e.target.value)} className={inputClass} placeholder="e.g. when piloting through a debris field / when firing the first shot of an ambush" />
              </Field>
              <Field label="Uses per scene">
                <select value={tUses} onChange={(e) => setTUses(Number(e.target.value))} className={inputClass}>
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
              <p className="mt-2 text-xs text-neutral-500">The narrower the scenario, the more the GM will let it hit. Keep it to one clear situation.</p>
            </div>
          )}

          <Nav back={() => setStep(2)} next={usName && usDesc && (usKind === "passive" ? pTarget : tScenario) ? () => setStep(4) : undefined} />
        </Section>
      )}

      {/* Step 4 — input review */}
      {step === 4 && (
        <Section>
          <H>Ready?</H>
          <p className="mb-4 text-neutral-400">Look this over. When you continue, the lanes will give you a history and check your details make sense in-world.</p>
          <div className="space-y-2 rounded-lg border border-edge bg-panel/50 p-5 text-sm">
            <Row k="Name" v={name} />
            <Row k="Faction" v={factionBriefs.find((f) => f.factionId === factionId)?.name ?? factionId} />
            <Row k="Background" v={backgrounds.find((b) => b.id === background)?.label ?? background} />
            <Row k="Focus" v={bias} />
            <Row k="Code" v={alignment} />
            <Row k="Ambition" v={ambition} />
            <Row k="Won't cross" v={moralCode || "— the lanes will invent it"} />
            {loss && <Row k="Loss" v={loss} />}
            {tie && <Row k="Tie" v={tie} />}
            {tell && <Row k="Tell" v={tell} />}
            <Row k="Signature" v={`${usName} — ${usKind === "passive" ? `+${Math.min(pAmount, amountCap)} ${pTarget}` : `nat-20 when: ${tScenario}`}`} />
          </div>
          {err && <p className="mt-3 text-sm text-bad">⚠ {err}</p>}
          <div className="mt-6 flex items-center justify-between">
            <button onClick={() => setStep(3)} className="text-sm text-neutral-500 hover:text-neutral-300">← back</button>
            <button
              onClick={() => create()}
              disabled={!canFinish || busy}
              className="rounded-lg bg-accent px-8 py-3 font-semibold text-ink disabled:opacity-40"
            >
              {busy ? "Bringing them to life…" : "Bring them to life →"}
            </button>
          </div>
        </Section>
      )}

      {/* Step 5 — meet your character */}
      {step === 5 && result && (
        <Section>
          <H>Meet {result.character.name}</H>

          {/* AI notes on free-text fields */}
          {result.notes
            .filter((n) => !dismissed.includes(n.field))
            .map((n) => (
              <div key={n.field} className="mb-3 rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
                <p className="text-accent">⚠ {n.message}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {n.field === "name" && n.suggestion && (
                    <button
                      onClick={() => acceptName(n.suggestion!)}
                      disabled={busy}
                      className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-ink disabled:opacity-40"
                    >
                      Use “{n.suggestion}”
                    </button>
                  )}
                  {n.field !== "name" && (
                    <button
                      onClick={() => setStep(n.field === "moralCode" ? 2 : 3)}
                      className="rounded-md border border-edge px-3 py-1 text-xs text-neutral-300 hover:border-accent hover:text-accent"
                    >
                      ← Edit
                    </button>
                  )}
                  <button
                    onClick={() => setDismissed((d) => [...d, n.field])}
                    className="rounded-md border border-edge px-3 py-1 text-xs text-neutral-400 hover:text-neutral-200"
                  >
                    Keep mine
                  </button>
                </div>
              </div>
            ))}

          {/* backstory (templated first, then swapped for the AI version) */}
          {result.character.backstory && (
            <div className="mb-5 rounded-lg border border-edge bg-panel/50 p-4">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-200">{result.character.backstory}</p>
              {result.enriching && (
                <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
                  <span
                    className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-600 border-t-accent"
                    aria-hidden
                  />
                  <span>Fleshing out your story…</span>
                </div>
              )}
            </div>
          )}

          <Sheet character={result.character} factionId={factionId} />

          <div className="mt-6 flex items-center justify-between">
            <button onClick={() => setStep(4)} className="text-sm text-neutral-500 hover:text-neutral-300">← back</button>
            <button
              onClick={() => router.push(`/play/${result.campaignId}`)}
              disabled={busy}
              className="rounded-lg bg-accent px-8 py-3 font-semibold text-ink disabled:opacity-40"
            >
              {busy ? "…" : "Enter the DRIFT →"}
            </button>
          </div>
        </Section>
      )}
    </main>
  );
}

/* ── character sheet display ───────────────────────────────────────────────── */
function Sheet({ character, factionId }: { character: Character; factionId: string }) {
  const sig = character.uniqueSkill;
  const sigLine = sig
    ? sig.kind === "passive"
      ? `+${sig.passiveAmount} ${sig.passiveTarget}`
      : `nat-20 · ${sig.triggerScenario}`
    : null;
  return (
    <div className="space-y-4 rounded-lg border border-edge bg-panel/40 p-5">
      {/* vitals */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="HP" value={`${character.hp}/${character.maxHp}`} />
        <Stat label="AC" value={character.ac} />
        <Stat label="Credits" value={`¢${character.credits ?? 0}`} />
        <Stat label="Stims" value={character.stims} />
      </div>

      {/* attributes */}
      <div>
        <SheetLabel>Attributes</SheetLabel>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ATTR_ORDER.map((a) => (
            <div key={a} className="rounded-md border border-edge/60 bg-ink/40 px-2 py-1.5 text-center">
              <div className="text-[10px] uppercase text-neutral-500">{a.slice(0, 3)}</div>
              <div className="text-sm font-semibold text-neutral-100">{fmt(character.attributes[a])}</div>
            </div>
          ))}
        </div>
      </div>

      {/* skills */}
      <div>
        <SheetLabel>Skills</SheetLabel>
        <div className="flex flex-wrap gap-1.5">
          {character.skills.map((s) => (
            <span key={s.name} className="rounded-full border border-edge bg-ink/40 px-2.5 py-1 text-xs text-neutral-200">
              {s.name} <span className="text-accent">{s.level}</span>
            </span>
          ))}
        </div>
      </div>

      {/* signature */}
      {sig && (
        <div>
          <SheetLabel>Signature</SheetLabel>
          <p className="text-sm text-neutral-200">
            <span className="font-semibold">{sig.name}</span>
            <span className="text-neutral-400"> — {sig.description}</span>
          </p>
          <p className="mt-0.5 text-xs text-accent/80">{sigLine}</p>
        </div>
      )}

      {/* code + voice (provided or invented by the finalize pass) */}
      {character.moralCode && (
        <div>
          <SheetLabel>The line you won't cross</SheetLabel>
          <p className="text-sm text-neutral-200">{character.moralCode}</p>
        </div>
      )}
      {character.voiceNotes && (
        <div>
          <SheetLabel>Voice</SheetLabel>
          <p className="text-sm italic text-neutral-400">{character.voiceNotes}</p>
        </div>
      )}

      {/* gear */}
      {character.gear.length > 0 && (
        <div>
          <SheetLabel>Gear</SheetLabel>
          <div className="flex flex-wrap gap-1.5">
            {character.gear.map((g, i) => (
              <span key={i} className="rounded-md border border-edge bg-ink/40 px-2 py-1 text-xs text-neutral-300">
                {g.name}{g.damage ? ` (${g.damage})` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-neutral-500">
        Starting with {factionBriefs.find((f) => f.factionId === factionId)?.name ?? "your faction"} as a low-level minion.{" "}
        {openingFor(factionId)?.loaner
          ? `You fly ${openingFor(factionId)!.loaner!.name}, a faction loaner — earn its title in play to make it yours.`
          : "No ship yet — you'll beg and borrow passage until you earn a hull of your own."}
      </p>
    </div>
  );
}

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-edge/60 bg-ink/40 py-2">
      <div className="text-[10px] uppercase text-neutral-500">{label}</div>
      <div className="text-sm font-semibold text-neutral-100">{value}</div>
    </div>
  );
}
function SheetLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs uppercase tracking-wide text-neutral-500">{children}</div>;
}

/* ── small presentational helpers ─────────────────────────────────────────── */
const inputClass = "w-full rounded-md border border-edge bg-ink px-3 py-2 text-[15px] outline-none focus:border-accent";

function Section({ children }: { children: React.ReactNode }) {
  return <div className="animate-in">{children}</div>;
}
function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 text-2xl font-bold text-neutral-100">{children}</h2>;
}
/** Faction names to accent (orange, bold) wherever they appear in prose. */
const FACTION_TERMS = ["Hollow Crown", "Sable Chain", "Undertow"];

function highlightTerms(text: string, terms: string[]): React.ReactNode[] {
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${esc.join("|")})`, "g");
  return text.split(re).map((part, i) =>
    terms.includes(part) ? (
      <span key={i} className="font-semibold text-accent">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function Prose({ text, highlight }: { text: string; highlight?: string[] }) {
  const content = highlight?.length ? highlightTerms(text, highlight) : text;
  return <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-300">{content}</div>;
}

/** Deterministic FNV-1a hash for the pixel-flag generator. */
function emblemHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const FACTION_COLORS: Record<string, string> = {
  "f-crown": "#e8a33d",
  "f-sable": "#d9584a",
  "f-undertow": "#8b93a6",
  "f-ledger": "#c99a5b",
  "f-meridian": "#6fae8f",
  "f-reclaimers": "#7fa6c9",
  "f-free": "#b98fd0",
  "f-wreckers": "#d9584a",
  "f-rook": "#c99a5b",
  "f-talos": "#6f7b93",
};

/**
 * A deterministic pixel-flag emblem per faction (identicon-style): a horizontally
 * mirrored 5×5 bitmap seeded from the faction id, in the faction's colour. No
 * assets — pure SVG rects, so it renders anywhere and never breaks the CSP.
 */
function FactionEmblem({ factionId, size = 46 }: { factionId: string; size?: number }) {
  const h = emblemHash(factionId);
  const color = FACTION_COLORS[factionId] ?? `hsl(${h % 360} 55% 62%)`;
  const W = 5;
  const H = 5;
  const cells: [number, number][] = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < 3; c++) {
      if ((h >> (r * 3 + c)) & 1) {
        cells.push([c, r]);
        if (c < 2) cells.push([W - 1 - c, r]); // mirror
      }
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0 rounded border border-edge"
      style={{ imageRendering: "pixelated" }}
      aria-hidden
    >
      <rect width={W} height={H} fill="#0b0e14" />
      {cells.map(([c, r], i) => (
        <rect key={i} x={c} y={r} width={1.02} height={1.02} fill={color} />
      ))}
    </svg>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
function Choices({
  options, value, onPick,
}: {
  options: { id: string; label: string; description: string }[];
  value: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onPick(o.id)}
          className={
            "rounded-lg border p-3 text-left transition " +
            (value === o.id ? "border-accent bg-panel" : "border-edge hover:border-neutral-600")
          }
        >
          <div className="font-semibold text-neutral-100">{o.label}</div>
          <div className="mt-0.5 text-xs text-neutral-400">{o.description}</div>
        </button>
      ))}
    </div>
  );
}
function KindCard({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-start gap-3 rounded-lg border-2 p-4 text-left transition " +
        (active ? "border-accent bg-accent/10" : "border-edge hover:border-neutral-600")
      }
    >
      <span
        className={
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 " +
          (active ? "border-accent" : "border-neutral-600")
        }
      >
        {active && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-neutral-100">{title}</span>
        <span className="mt-1 block text-xs text-neutral-400">{desc}</span>
      </span>
    </button>
  );
}
function Next({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="mt-6 rounded-lg bg-accent px-6 py-3 font-semibold text-ink">
      {children}
    </button>
  );
}
function Nav({ back, next }: { back: () => void; next?: () => void }) {
  return (
    <div className="mt-6 flex items-center justify-between">
      <button onClick={back} className="text-sm text-neutral-500 hover:text-neutral-300">← back</button>
      <button
        onClick={next}
        disabled={!next}
        className="rounded-lg bg-accent px-6 py-2.5 font-semibold text-ink disabled:opacity-40"
      >
        Continue →
      </button>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-edge/50 py-1 last:border-0">
      <span className="text-neutral-500">{k}</span>
      <span className="text-right text-neutral-200">{v}</span>
    </div>
  );
}
function FlavorField({
  label, value, onChange, placeholder, examples,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  examples: string[];
}) {
  // Show a rotating handful of the (larger) pool rather than the whole list.
  const [seed, setSeed] = useState(0);
  const shown = useMemo(() => sample(examples, CHIP_COUNT, seed), [examples, seed]);
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm text-neutral-400">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} placeholder={placeholder} />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {shown.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className="rounded-full border border-edge px-2.5 py-1 text-xs text-neutral-400 hover:border-accent hover:text-accent"
          >
            {c}
          </button>
        ))}
        {examples.length > CHIP_COUNT && (
          <button
            type="button"
            onClick={() => setSeed((s) => s + 1)}
            className="rounded-full px-2 py-1 text-xs text-neutral-500 hover:text-accent"
            title="Show different suggestions"
          >
            ↻
          </button>
        )}
      </div>
    </div>
  );
}
