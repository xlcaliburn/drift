"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CampaignState } from "@/shared/schemas";
import type { NpcRelations, SceneCard, SceneMemory } from "@/shared/scene";
import type { CombatState } from "@/shared/combat";
import type { ChoiceOption } from "@/shared/turnPlan";

interface Detail {
  state: CampaignState;
  sceneCard: SceneCard;
  npcRelations: NpcRelations;
  combat: CombatState | null;
  lastChoices: ChoiceOption[];
  recentScenes: SceneMemory[];
  transcriptTail: { role: string; text: string }[];
  updatedAt: string | null;
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/** Admin editor for one campaign. Every edit PATCHes an op that flows through the
 *  server session store, so it sticks even while the player is active. */
export default function CampaignEditor({ campaignId }: { campaignId: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [nonce, setNonce] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/campaigns/${campaignId}`);
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "failed to load");
      return;
    }
    setD(data);
    setNonce((n) => n + 1);
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Send one op. Returns an error string (shown inline) or null on success. */
  const patch = useCallback(
    async (op: Record<string, unknown>): Promise<string | null> => {
      setErr(null);
      setMsg(null);
      const res = await fetch(`/api/admin/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...op, visible }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = data.error ?? (data.issues ? JSON.stringify(data.issues) : "failed");
        return typeof e === "string" ? e : JSON.stringify(e);
      }
      setMsg(`✓ ${data.summary ?? "saved"}`);
      await load();
      return null;
    },
    [campaignId, visible, load],
  );

  // Quick-action helper: patch the PC with a shallow field override.
  const patchPc = (over: Record<string, unknown>) => {
    const pc = d?.state.characters.find((c) => c.kind === "pc");
    if (!pc) return;
    quick({ op: "character", value: { ...pc, ...over } });
  };
  const quick = async (op: Record<string, unknown>) => {
    const e = await patch(op);
    if (e) setErr(e);
  };

  if (err && !d) return <div className="text-sm text-bad">{err} · <Link href="/admin/campaigns" className="text-accent">back</Link></div>;
  if (!d) return <p className="text-sm text-neutral-500">Loading…</p>;

  const pc = d.state.characters.find((c) => c.kind === "pc") ?? d.state.characters[0];
  const staleMs = d.updatedAt ? Date.now() - new Date(d.updatedAt).getTime() : Infinity;
  const activeRecently = staleMs < 90_000;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm">
        <Link href="/admin/campaigns" className="text-neutral-500 hover:text-accent">← Campaigns</Link>
        <span className="text-neutral-600">·</span>
        <span className="text-xs text-neutral-500">{campaignId}</span>
      </div>

      {/* Header: identity + vitals + warnings. */}
      <div className="rounded-lg border border-edge bg-panel/40 p-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold text-neutral-100">{pc?.name ?? "—"}</h2>
          <span className="text-sm text-neutral-400">
            HP {pc?.hp}/{pc?.maxHp} · AC {pc?.ac} · ¢{pc?.credits ?? 0} · stims {pc?.stims ?? 0}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${d.state.campaign.status === "deceased" ? "border-bad/60 text-bad" : "border-good/60 text-good"}`}>
            {d.state.campaign.status}
          </span>
          {d.combat?.active && <span className="rounded-full border border-accent/60 px-2 py-0.5 text-[11px] text-accent">in combat</span>}
          {(pc?.injuries ?? []).map((i) => (
            <span key={i.name} className="rounded-full border border-bad/50 px-2 py-0.5 text-[11px] text-bad">{i.name}</span>
          ))}
        </div>
        {activeRecently && (
          <p className="mt-2 text-[11px] text-accent">
            ⚠ Active {Math.round(staleMs / 1000)}s ago — an edit landing mid-turn can be lost. Retry if it doesn&apos;t stick.
          </p>
        )}
        <label className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          Show the player a &quot;⚙ GM&quot; note in their transcript for each edit
        </label>
      </div>

      {(msg || err) && (
        <div className={`rounded-md border px-3 py-2 text-sm ${err ? "border-bad/50 text-bad" : "border-good/50 text-good"}`}>{err ?? msg}</div>
      )}

      {/* Quick actions. */}
      <div className="flex flex-wrap gap-2">
        <Action onClick={() => quick({ op: "revive" })}>Revive</Action>
        <Action onClick={() => patchPc({ hp: pc?.maxHp })}>Full heal</Action>
        <Action onClick={() => patchPc({ stims: (pc?.stims ?? 0) + 1 })}>+1 stim</Action>
        <Action
          onClick={() => {
            const v = window.prompt("Credit change (e.g. 500 or -200)", "");
            const n = Number(v);
            if (v != null && Number.isFinite(n) && n !== 0) patchPc({ credits: Math.max(0, (pc?.credits ?? 0) + n) });
          }}
        >
          ± credits
        </Action>
        {d.combat?.active && <Action onClick={() => quick({ op: "endCombat" })}>End combat</Action>}
        {d.lastChoices.length > 0 && <Action onClick={() => quick({ op: "clearChoices" })}>Clear choices</Action>}
        <Action onClick={() => quick({ op: "newScene" })}>New scene</Action>
      </div>

      {/* GM note — steer the STORY without touching state. */}
      <div className="rounded-lg border border-edge bg-panel/40 p-3">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Note to narrator (course-corrects the story)</div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. Draven already paid them — move on to the heist. Don't restate the standoff."
          className="mt-1 w-full rounded-md border border-edge bg-ink px-2 py-1 text-sm text-neutral-200 outline-none focus:border-accent"
        />
        <button
          disabled={!note.trim()}
          onClick={async () => {
            const e = await patch({ op: "gmNote", value: note.trim() });
            if (e) setErr(e);
            else setNote("");
          }}
          className="mt-1 rounded-md border border-accent/60 px-3 py-1 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          Send note
        </button>
      </div>

      {/* Structured JSON editors — one per slice. Remounted on each reload (key). */}
      <div className="space-y-3">
        {d.state.characters.map((c) => (
          <JsonSection key={`char-${c.id}-${nonce}`} title={`Character — ${c.name} (${c.kind})`} value={c} onSave={(v) => patch({ op: "character", value: v })} />
        ))}
        {d.state.ship && <JsonSection key={`ship-${nonce}`} title="Ship" value={d.state.ship} onSave={(v) => patch({ op: "ship", value: v })} />}
        <JsonSection key={`scene-${nonce}`} title="Scene (situation · place · dangers · present NPCs · beats)" value={d.sceneCard} onSave={(v) => patch({ op: "sceneCard", value: v })} />
        <JsonSection key={`threads-${nonce}`} title={`Story threads (${d.state.threads.length})`} value={d.state.threads} onSave={(v) => patch({ op: "threads", value: v })} />
        <JsonSection key={`clocks-${nonce}`} title={`Clocks (${d.state.clocks.length})`} value={d.state.clocks} onSave={(v) => patch({ op: "clocks", value: v })} />
        <JsonSection key={`rel-${nonce}`} title="NPC relations (disposition · notes · history)" value={d.npcRelations} onSave={(v) => patch({ op: "npcRelations", value: v })} />
        <JsonSection key={`npcs-${nonce}`} title={`NPC cast (${d.state.npcs.length}) — edit/add`} value={d.state.npcs} onSave={(v) => patch({ op: "npcs", value: v })}
          extra={<DeleteNpc npcs={d.state.npcs} onDelete={(ids) => quick({ op: "deleteNpcs", ids })} />} />
        <JsonSection key={`rep-${nonce}`} title={`Faction rep (${d.state.factionRep.length})`} value={d.state.factionRep} onSave={(v) => patch({ op: "factionRep", value: v })} />
        <JsonSection key={`camp-${nonce}`} title="Campaign settings (directive · location · status · tendays)" value={campaignSettings(d.state)} onSave={(v) => patch({ op: "campaign", value: v })} />
        {d.recentScenes.length > 0 && (
          <JsonSection key={`scenes-${nonce}`} title={`Recent scene summaries (${d.recentScenes.length}) — edit one { seq, title, summary }`} value={d.recentScenes} onSave={(v) => patch({ op: "sceneSummary", value: pickSceneSummary(v) })} />
        )}
      </div>

      {/* Recent transcript for context (read-only). */}
      <details className="rounded-lg border border-edge bg-panel/20">
        <summary className="cursor-pointer px-3 py-2 text-[11px] uppercase tracking-wide text-neutral-500">Recent transcript (read-only)</summary>
        <div className="max-h-[40vh] space-y-1 overflow-y-auto p-3 text-[12px]">
          {d.transcriptTail.map((e, i) => (
            <div key={i} className={e.role === "player" ? "text-right text-neutral-300" : e.role === "system" ? "text-neutral-500" : "text-neutral-200"}>
              <span className="text-[10px] uppercase text-neutral-600">{e.role} </span>
              {e.text}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function campaignSettings(state: CampaignState) {
  const c = state.campaign;
  return { name: c.name, directive: c.directive ?? null, currentLocationId: c.currentLocationId ?? null, situation: c.situation ?? null, status: c.status, narratorModel: c.narratorModel ?? null, tendaysElapsed: c.tendaysElapsed };
}

/** The scene-summary editor holds the whole recentScenes array; on save we send the
 *  first element (admin edits one at a time — the shape is { seq, title, summary }). */
function pickSceneSummary(v: unknown): { seq: number; title: string; summary: string } {
  const arr = Array.isArray(v) ? v : [v];
  const s = arr[0] as { seq: number; title: string; summary: string };
  return { seq: s.seq, title: s.title, summary: s.summary };
}

function Action({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-accent hover:text-accent">
      {children}
    </button>
  );
}

function JsonSection({ title, value, onSave, extra }: { title: string; value: unknown; onSave: (v: unknown) => Promise<string | null>; extra?: React.ReactNode }) {
  const [text, setText] = useState(pretty(value));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = text !== pretty(value);

  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setErr(`Invalid JSON: ${e instanceof Error ? e.message : e}`);
      return;
    }
    setSaving(true);
    const e = await onSave(parsed);
    setSaving(false);
    setErr(e);
  }

  return (
    <details className="rounded-lg border border-edge bg-panel/30">
      <summary className="cursor-pointer px-3 py-2 text-sm text-neutral-200">{title}</summary>
      <div className="space-y-2 border-t border-edge p-3">
        {extra}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={Math.min(24, Math.max(4, text.split("\n").length))}
          className="scrollbar-thin w-full whitespace-pre rounded-md border border-edge bg-ink px-2 py-1 font-mono text-[11px] leading-relaxed text-neutral-200 outline-none focus:border-accent"
        />
        {err && <pre className="whitespace-pre-wrap text-[11px] text-bad">{err}</pre>}
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-md border border-accent/60 px-3 py-1 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {dirty && <span className="text-[11px] text-neutral-500">unsaved changes</span>}
        </div>
      </div>
    </details>
  );
}

function DeleteNpc({ npcs, onDelete }: { npcs: { id: string; name: string }[]; onDelete: (ids: string[]) => void }) {
  const deletable = npcs.filter((n) => n.id.startsWith("npc-gen-") || n.id.startsWith("npc-rel-"));
  const [sel, setSel] = useState("");
  if (!deletable.length) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-bad/30 bg-bad/5 px-2 py-1.5">
      <span className="text-[11px] text-neutral-400">Delete an NPC (removes from cast + shared universe):</span>
      <select value={sel} onChange={(e) => setSel(e.target.value)} className="rounded-md border border-edge bg-ink px-2 py-1 text-[11px] text-neutral-200">
        <option value="">select…</option>
        {deletable.map((n) => (
          <option key={n.id} value={n.id}>{n.name} ({n.id})</option>
        ))}
      </select>
      <button
        disabled={!sel}
        onClick={() => {
          if (sel && window.confirm(`Delete NPC ${sel}? This removes it from the shared universe too.`)) onDelete([sel]);
          setSel("");
        }}
        className="rounded-md border border-bad/60 px-2 py-1 text-[11px] font-semibold text-bad hover:bg-bad/15 disabled:opacity-40"
      >
        Delete
      </button>
    </div>
  );
}
