"use client";

import type { CampaignState } from "@/shared/schemas";
import type { ChoiceOption } from "@/shared/turnPlan";
import type { Job } from "@/shared/quests";

/**
 * The JOB BOARD tab (QUESTS.md) — the engine-owned procedural work the player can
 * take on. Two lists: jobs they're ON (with per-objective progress) and the OFFERED
 * board. Accept/abandon fire a normal turn carrying the chip (acceptJob/abandonJob),
 * so the narrator acknowledges the handshake while the engine moves the board.
 */

const TIER_LABEL: Record<string, string> = { T0: "Odd job", T1: "Standard", T2: "Big score", T3: "Major score" };

function ObjectiveRow({ done, text }: { done: boolean; text: string }) {
  return (
    <div className={"flex gap-1.5 text-[12px] " + (done ? "text-neutral-600 line-through" : "text-neutral-300")}>
      <span className={done ? "text-good" : "text-neutral-600"}>{done ? "✓" : "○"}</span>
      <span>{text}</span>
    </div>
  );
}

function ActiveJob({ job, onAbandon }: { job: Job; onAbandon?: () => void }) {
  const nextIdx = job.objectives.findIndex((o) => !o.done);
  return (
    <div className="rounded border border-edge p-2">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-neutral-100">{job.title}</span>
        {onAbandon && (
          <button
            onClick={onAbandon}
            className="shrink-0 text-[11px] text-neutral-600 underline decoration-dotted underline-offset-2 hover:text-bad"
          >
            drop
          </button>
        )}
      </div>
      <div className="mt-1 space-y-0.5">
        {job.objectives.map((o, i) => (
          <ObjectiveRow key={o.id} done={o.done} text={i === nextIdx ? `${o.summary} ← next` : o.summary} />
        ))}
      </div>
      {job.complication && <p className="mt-1 text-[11px] italic text-amber-500/80">⚠ {job.complication}</p>}
    </div>
  );
}

function OfferedJob({ job, faction, onAccept }: { job: Job; faction?: string; onAccept?: () => void }) {
  return (
    <div className="rounded border border-edge p-2">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-neutral-100">{job.title}</span>
        <span className="shrink-0 rounded bg-ink px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
          {TIER_LABEL[job.reward.tier] ?? job.reward.tier}
        </span>
      </div>
      <p className="mt-0.5 text-[12px] text-neutral-400">{job.blurb}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-neutral-600">
        <span className="truncate">
          {faction ? `${faction} · ` : ""}
          {job.reward.repFactionId ? "pays + reputation" : "pays on delivery"}
        </span>
        {onAccept && (
          <button
            onClick={onAccept}
            className="shrink-0 rounded border border-accent/60 px-2 py-0.5 text-[11px] text-accent hover:bg-accent/10"
          >
            Take it
          </button>
        )}
      </div>
      {job.complication && <p className="mt-1 text-[11px] italic text-amber-500/80">⚠ {job.complication}</p>}
    </div>
  );
}

export function JobsTab({
  state,
  jobs,
  onJobAction,
}: {
  state: CampaignState;
  jobs: Job[];
  onJobAction?: (choice: ChoiceOption) => void;
}) {
  const active = jobs.filter((j) => j.status === "active");
  // The board is LOCAL — only postings from the station you're at (legacy jobs with
  // no posting location still show). Jobs you accept move to "On the job" and follow
  // you anywhere.
  const here = state.campaign.currentLocationId;
  const offered = jobs.filter(
    (j) => j.status === "offered" && (j.postedLocationId === undefined || j.postedLocationId === here),
  );
  const factionName = (id?: string) => state.factions.find((f) => f.id === id)?.name;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 uppercase tracking-wide text-neutral-500">On the job</h3>
        {active.length === 0 ? (
          <p className="text-neutral-600">Nothing active. Take a job from the board below.</p>
        ) : (
          <div className="space-y-2">
            {active.map((j) => (
              <ActiveJob
                key={j.id}
                job={j}
                onAbandon={
                  onJobAction ? () => onJobAction({ label: `I walk away from the ${j.title.toLowerCase()} job.`, abandonJob: j.id }) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 uppercase tracking-wide text-neutral-500">Job board</h3>
        {offered.length === 0 ? (
          <p className="text-neutral-600">The board&apos;s quiet right now.</p>
        ) : (
          <div className="space-y-2">
            {offered.map((j) => (
              <OfferedJob
                key={j.id}
                job={j}
                faction={factionName(j.factionId)}
                onAccept={
                  onJobAction ? () => onJobAction({ label: `I take the job: ${j.title}.`, acceptJob: j.id }) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
