"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { worldIntro, seasonOneSpine, factionBriefs } from "@/content/briefs";
import { backgrounds, alignments, ambitions } from "@/content/creation";
import type { CreationInput } from "@/shared/multiplayer";

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

type Kind = "passive" | "trigger";

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // form state
  const [name, setName] = useState("");
  const [factionId, setFactionId] = useState("");
  const [bias, setBias] = useState("");
  const [alignment, setAlignment] = useState("");
  const [background, setBackground] = useState("");
  const [ambition, setAmbition] = useState("");
  const [moralCode, setMoralCode] = useState("");

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
    name && factionId && bias && alignment && background && ambition && moralCode &&
    usName && usDesc && (usKind === "passive" ? pTarget : tScenario);

  async function create() {
    setBusy(true);
    setErr("");
    const payload: CreationInput = {
      name, parentFactionId: factionId,
      bias: bias as CreationInput["bias"],
      alignment: alignment as CreationInput["alignment"],
      background, ambition, moralCode, uniqueSkill,
    };
    try {
      const res = await fetch("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) setErr(data.error);
      else router.push(`/play/${data.campaignId}`);
    } catch {
      setErr("Failed to create character.");
    } finally {
      setBusy(false);
    }
  }

  const steps = ["The world", "Your faction", "Who you are", "Your signature", "Begin"];

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
          <Next onClick={() => setStep(1)}>Enter the lanes →</Next>
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
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="What do they call you?" />
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

          <Field label="The line you won't cross">
            <input value={moralCode} onChange={(e) => setMoralCode(e.target.value)} className={inputClass} placeholder="e.g. people aren't cargo" />
          </Field>

          <Nav back={() => setStep(1)} next={name && background && bias && alignment && ambition && moralCode ? () => setStep(3) : undefined} />
        </Section>
      )}

      {/* Step 3 — unique skill */}
      {step === 3 && (
        <Section>
          <H>Your signature</H>
          <p className="mb-5 text-neutral-400">One thing that makes you unlike anyone else in the lanes. Pick its shape:</p>

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

      {/* Step 4 — review */}
      {step === 4 && (
        <Section>
          <H>Ready to begin</H>
          <div className="space-y-2 rounded-lg border border-edge bg-panel/50 p-5 text-sm">
            <Row k="Name" v={name} />
            <Row k="Faction" v={factionBriefs.find((f) => f.factionId === factionId)?.name ?? factionId} />
            <Row k="Background" v={backgrounds.find((b) => b.id === background)?.label ?? background} />
            <Row k="Focus" v={bias} />
            <Row k="Code" v={alignment} />
            <Row k="Ambition" v={ambition} />
            <Row k="Won't cross" v={moralCode} />
            <Row k="Signature" v={`${usName} — ${usKind === "passive" ? `+${Math.min(pAmount, amountCap)} ${pTarget}` : `nat-20 when: ${tScenario}`}`} />
          </div>
          {err && <p className="mt-3 text-sm text-bad">⚠ {err}</p>}
          <div className="mt-6 flex items-center justify-between">
            <button onClick={() => setStep(3)} className="text-sm text-neutral-500 hover:text-neutral-300">← back</button>
            <button
              onClick={create}
              disabled={!canFinish || busy}
              className="rounded-lg bg-accent px-8 py-3 font-semibold text-ink disabled:opacity-40"
            >
              {busy ? "Spinning up…" : "Enter the DRIFT"}
            </button>
          </div>
        </Section>
      )}
    </main>
  );
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
