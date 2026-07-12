import { NextRequest, NextResponse } from "next/server";
import { FeatureRequest, FeedbackStatus } from "@/shared/feedback";
import { listRequests, saveRequest, decideRequest, formatFeedback } from "@/lib/feedback";

export const runtime = "nodejs";

/** GET /api/feedback — all requests, newest first (owner view + player status). */
export async function GET() {
  return NextResponse.json({ requests: listRequests() });
}

/** POST /api/feedback { text, authorName?, campaignId? } — submit + LLM-format. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = (body.text ?? "").toString().trim();
  if (!raw) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (raw.length > 2000) {
    return NextResponse.json({ error: "keep requests under 2000 characters" }, { status: 400 });
  }

  const formatted = await formatFeedback(raw);
  const request = FeatureRequest.parse({
    id: `fr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    campaignId: body.campaignId ? String(body.campaignId) : undefined,
    authorName: (body.authorName ?? "anonymous").toString().slice(0, 60),
    raw,
    ...formatted,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  saveRequest(request);
  return NextResponse.json({ request });
}

/**
 * PATCH /api/feedback { id, status, note? } — approve/decline/done.
 * TODO(auth): once Google login lands, gate this to the universe owner.
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const status = FeedbackStatus.safeParse(body.status);
  if (!body.id || !status.success) {
    return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  }
  const updated = decideRequest(String(body.id), status.data, body.note ? String(body.note) : undefined);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ request: updated });
}
