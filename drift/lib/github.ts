import "server-only";

/**
 * GitHub issue creation. Currently used to file an issue for every player APPEAL (a
 * mechanical dispute the player escalated to the judge), so disputes surface as
 * trackable items in the repo instead of only living in the audit log.
 *
 * Best-effort + env-gated, mirroring lib/audit.ts: with no GITHUB_TOKEN / GITHUB_REPO
 * it no-ops (like keyless mode), and it NEVER throws — a GitHub hiccup must not break
 * a turn.
 *
 * Setup (server env, e.g. .env.local + the deployment):
 *   GITHUB_TOKEN  — a PAT (classic `repo`/`public_repo`, or a fine-grained token with
 *                   Issues: Read & write on the target repo).
 *   GITHUB_REPO   — "owner/name" (e.g. "xlcaliburn/drift").
 *   GITHUB_APPEAL_LABELS — optional, comma-separated (default "appeal"); labels must
 *                   already exist in the repo (unknown labels are ignored by GitHub).
 *
 * PRIVACY: the issue body carries the player's name/email + their appeal text. Point
 * this at a PRIVATE repo — a public one would expose player content.
 */

/** Self-contained debugging context, so triaging an appeal doesn't need a live SQL
 *  dig into campaign_runtime / ai_calls / the transcript. All optional. */
export interface AppealContext {
  /** "Meridian Ring — Valis's office (loc-meridian)". */
  where?: string;
  /** Model-maintained one-liner of what's happening. */
  situation?: string;
  /** "3/18 (Downed) · ¢420 · 2 stims". */
  vitals?: string;
  /** Present NPC names. */
  presentNpcs?: string[];
  /** Active fight summary, e.g. "T2 fight, round 3: Thug 1 (4/8), Thug 2 (8/8)". */
  combat?: string;
  /** Recent play-by-play (role-prefixed lines), oldest→newest — the disputed beats. */
  transcriptTail?: string[];
  /** Recent engine/dice lines, oldest→newest — the mechanical trail. */
  engineLogTail?: string[];
}

export interface AppealIssueInput {
  /** Who filed it — display name or email. */
  reporter: string;
  campaignId: string;
  character?: string;
  granted: boolean;
  appealText: string;
  ruling: string;
  /** Engine adjustment lines applied by a granted ruling. */
  adjustments?: string[];
  model?: string;
  /** Everything a triager would otherwise SQL for (see AppealContext). */
  context?: AppealContext;
}

const quote = (s: string) =>
  (s.trim() || "—")
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

/** A collapsible code block (kept folded so a long dump doesn't bury the issue). */
function foldedCode(summary: string, lines: string[]): string {
  if (!lines.length) return "";
  return `\n<details><summary>${summary}</summary>\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n</details>`;
}

/** Build the issue title + body — pure, so it's unit-testable without a network call. */
export function buildAppealIssue(input: AppealIssueInput): { title: string; body: string } {
  const outcome = input.granted ? "granted" : "denied";
  const oneLine = input.appealText.replace(/\s+/g, " ").trim();
  const snippet = oneLine.slice(0, 80);
  const title = `[appeal ${outcome}] ${input.character ?? "player"}: ${snippet}${oneLine.length > 80 ? "…" : ""}`;
  const c = input.context;
  const body = [
    `**Outcome:** ${outcome}`,
    `**Player:** ${input.reporter}`,
    `**Character:** ${input.character ?? "—"}${c?.vitals ? ` — ${c.vitals}` : ""}`,
    c?.where ? `**Where:** ${c.where}` : "",
    c?.situation ? `**Situation:** ${c.situation}` : "",
    c?.presentNpcs?.length ? `**Present:** ${c.presentNpcs.join(", ")}` : "",
    c?.combat ? `**Combat:** ${c.combat}` : "",
    `**Campaign:** \`${input.campaignId}\``,
    input.model ? `**Judge model:** ${input.model}` : "",
    "",
    "### The appeal",
    quote(input.appealText),
    "",
    "### The ruling",
    quote(input.ruling),
    input.adjustments?.length ? `\n### Engine adjustments applied\n${input.adjustments.map((a) => `- ${a}`).join("\n")}` : "",
    // Self-contained debug context — folded so the issue stays scannable.
    foldedCode("Recent transcript (the disputed beats)", c?.transcriptTail ?? []),
    foldedCode("Recent engine log (dice / resources)", c?.engineLogTail ?? []),
    "",
    "<sub>Filed automatically by DRIFT when a player used the appeal function.</sub>",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { title, body };
}

function appealLabels(): string[] {
  const raw = process.env.GITHUB_APPEAL_LABELS;
  if (raw === undefined) return ["appeal"];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** File a GitHub issue for a player appeal. No-op without env config; never throws. */
export async function createAppealIssue(input: AppealIssueInput): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/name"
  if (!token || !repo) return;
  const { title, body } = buildAppealIssue(input);
  const labels = appealLabels();
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body, ...(labels.length ? { labels } : {}) }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[github] appeal issue failed: ${res.status} ${detail.slice(0, 300)}`);
    } else {
      const data = (await res.json().catch(() => ({}))) as { number?: number };
      console.info(`[github] filed appeal issue #${data.number ?? "?"} for campaign ${input.campaignId}`);
    }
  } catch (err) {
    console.error("[github] appeal issue error:", err instanceof Error ? err.message : err);
  }
}
