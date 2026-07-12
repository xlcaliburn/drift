"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { worldIntro, seasonOneSpine, factionBriefs } from "@/content/briefs";
import { backgrounds, alignments, ambitions } from "@/content/creation";
import {
  suggestName,
  exampleSkills,
  exampleMoralCodes,
  exampleLosses,
  exampleTies,
  exampleTells,
} from "@/content/examples";
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

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

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
      if (data.error) setErr(data.error);
      else {
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
    <main className="mx-auto max-w-2xl px-6 py-10">
      {/* progress */}
      <div className="mb-8 flex items-center gap-2 text-xs text-neutral-500">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={i === step ? "font-semibold text-accent" : i < step ? "text-good" : ""}>{s}</span>
            {i < steps.length - 1 && <span className="text-edge">→</span>}
          </div>
        ))}
      </div>

      {/* Step 0 — world */}
      {step === 0 && (
        <Section>
          <h1 className="mb-4 text-3xl font-bold text-accent">DRIFT</h1>
          <Prose text={worldIntro} />
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
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold">{f.name}</span>
                  <span className="text-xs italic text-neutral-500">{f.tagline}</span>
                </div>
                <p className="mt-1 text-sm text-neutral-400">{f.brief}</p>
                <p className="mt-2 text-xs text-accent/80">Playstyle: {f.playstyle}</p>
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
            <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">For inspiration — click to use, then tweak</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {exampleSkills.map((ex) => (
                <button
                  key={ex.skill.name}
                  type="button"
                  onClick={() => applyExample(ex.skill)}
                  className={
                    "rounded-lg border p-3 text-left transition " +
                    (usName === ex.skill.name ? "border-accent bg-panel" : "border-edge hover:border-neutral-600")
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

          <div className="mb-4 grid grid-cols-2 gap-3">
            <KindCard active={usKind === "passive"} onClick={() => setUsKind("passive")} title="Always-on edge" desc="A small, constant buff to something you do. Reliable." />
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
              <div className="grid grid-cols-3 gap-3">
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

          {/* backstory */}
          {result.character.backstory && (
            <div className="mb-5 rounded-lg border border-edge bg-panel/50 p-4">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-200">{result.character.backstory}</p>
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
        Starting with {factionBriefs.find((f) => f.factionId === factionId)?.name ?? "your faction"}. No ship yet — mobility is earned in play.
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
function Prose({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-300">{text}</div>;
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
      className={"rounded-lg border p-4 text-left transition " + (active ? "border-accent bg-panel" : "border-edge hover:border-neutral-600")}
    >
      <div className="font-semibold text-neutral-100">{title}</div>
      <div className="mt-1 text-xs text-neutral-400">{desc}</div>
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
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm text-neutral-400">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} placeholder={placeholder} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {examples.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className="rounded-full border border-edge px-2.5 py-1 text-xs text-neutral-400 hover:border-accent hover:text-accent"
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
