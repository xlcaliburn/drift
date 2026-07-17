"use client";

import { useState } from "react";
import type { CampaignState, Attributes } from "@/shared/schemas";
import { ATTR_KEYS, ATTR_MIN, ATTR_MAX, pointsRemaining } from "@/shared/respec";
import { pack } from "@/content/pack";
import { SheetSection } from "./ui";

/** Remake the character at Chrome's studio (Rook, ¢500): rename, REALLOCATE
 *  attributes within the creation budget (engine-validated), and reshape the look.
 *  A polished physical description is generated and shown below after the remake. */
export function RemakeEditor({
  state,
  character: c,
  onSaved,
}: {
  state: CampaignState;
  character: CampaignState["characters"][number];
  onSaved?: () => void;
}) {
  const atRook = state.campaign.currentLocationId === pack.services.bodyMod;
  const [name, setName] = useState(c.name);
  const [attrs, setAttrs] = useState<Attributes>({ ...c.attributes });
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState("");

  const COST = 500;
  const left = pointsRemaining(attrs);
  const canAfford = (c.credits ?? 0) >= COST;
  const changed =
    name.trim() !== c.name ||
    hint.trim() !== "" ||
    ATTR_KEYS.some((k) => attrs[k] !== c.attributes[k]);
  const ready = atRook && canAfford && left === 0 && changed && !busy;

  function bump(k: keyof Attributes, delta: number) {
    setAttrs((a) => ({ ...a, [k]: Math.max(ATTR_MIN, Math.min(ATTR_MAX, (a[k] ?? 0) + delta)) }));
  }

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setStatus("idle");
    setErrMsg("");
    try {
      const attrsChanged = ATTR_KEYS.some((k) => attrs[k] !== c.attributes[k]);
      const res = await fetch("/api/respec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: state.campaign.id,
          name: name.trim() !== c.name ? name.trim() : undefined,
          attributes: attrsChanged ? attrs : undefined,
          appearanceHint: hint.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("ok");
        setHint("");
        onSaved?.();
      } else {
        setStatus("err");
        setErrMsg(data.error ?? "remake failed");
      }
    } catch {
      setStatus("err");
      setErrMsg("request failed");
    } finally {
      setBusy(false);
    }
  }

  if (!atRook) {
    return (
      <SheetSection label="Remake">
        <p className="text-[12px] text-neutral-500">
          Chrome runs a body-modification studio on <span className="text-neutral-300">Rook Station</span> — a new face,
          build, or name, for a price. Get to Rook to remake your character.
        </p>
      </SheetSection>
    );
  }

  return (
    <SheetSection label="Remake at Chrome's · ¢500">
      <p className="mb-2 text-[12px] text-neutral-500">
        Rename, reshape your build, and change your look. Points must balance — a remake can't power-creep past a fresh
        character. A new description is written up afterward.
      </p>

      <label className="mb-2 block">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="mt-0.5 w-full rounded-lg border border-edge bg-ink px-3 py-1.5 text-[13px] outline-none focus:border-accent"
        />
      </label>

      <div className="mb-2">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">Attributes</span>
          <span className={"text-[11px] " + (left === 0 ? "text-good" : "text-bad")}>
            {left === 0 ? "balanced" : `${left > 0 ? "+" : ""}${left} to place`}
          </span>
        </div>
        <div className="space-y-1">
          {ATTR_KEYS.map((k) => {
            const v = attrs[k] ?? 0;
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="w-20 text-[12px] capitalize text-neutral-300">{k}</span>
                <button
                  onClick={() => bump(k, -1)}
                  disabled={v <= ATTR_MIN}
                  className="h-6 w-6 rounded border border-edge text-neutral-300 disabled:opacity-30 hover:border-accent"
                >
                  −
                </button>
                <span className={"w-8 text-center tabular-nums " + (v > 0 ? "text-good" : v < 0 ? "text-bad" : "text-neutral-400")}>
                  {v >= 0 ? "+" : ""}
                  {v}
                </span>
                <button
                  onClick={() => bump(k, 1)}
                  disabled={v >= ATTR_MAX}
                  className="h-6 w-6 rounded border border-edge text-neutral-300 disabled:opacity-30 hover:border-accent"
                >
                  +
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <label className="mb-2 block">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">The look you want</span>
        <textarea
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          rows={2}
          maxLength={400}
          placeholder="e.g. shave the head, harder jaw, laceworked chrome down one arm"
          className="mt-0.5 w-full resize-none rounded-lg border border-edge bg-ink px-3 py-1.5 text-[13px] outline-none focus:border-accent"
        />
      </label>

      <div className="flex items-center justify-between">
        <span className="text-[11px]">
          {status === "ok" && <span className="text-good">✓ remade — see the new description below</span>}
          {status === "err" && <span className="text-bad">⚠ {errMsg}</span>}
          {status === "idle" && !canAfford && <span className="text-bad">Need ¢{COST} — you hold ¢{c.credits ?? 0}</span>}
          {status === "idle" && canAfford && left !== 0 && <span className="text-neutral-500">Balance the points to remake</span>}
        </span>
        <button
          onClick={submit}
          disabled={!ready}
          className="rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-ink disabled:opacity-40"
        >
          {busy ? "Under the needle…" : `Remake · ¢${COST}`}
        </button>
      </div>
    </SheetSection>
  );
}
