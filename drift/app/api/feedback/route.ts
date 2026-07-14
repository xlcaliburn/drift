import { NextRequest, NextResponse } from "next/server";
import { FeatureRequest, FeedbackStatus } from "@/shared/feedback";
import { listRequests, listRequestsByAuthor, saveRequest, decideRequest, formatFeedback } from "@/lib/feedback";
import { requireApprovedUser, requireAdmin, isDevUser } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/feedback — admin: the full review queue. `?mine=1` — any approved
 *  user: only their own submissions, so players can track feedback status. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("mine") === "1") {
    const auth = await requireApprovedUser();
    if (auth.error) return auth.error;
    return NextResponse.json({ requests: await listRequestsByAuthor(auth.user.id) });
  }
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  return NextResponse.json({ requests: await listRequests() });
}

/** POST /api/feedback { text, authorName?, campaignId? } — submit + LLM-format. */
export async function POST(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;
  const user = auth.user;

  const body = await req.json().catch(() => ({}));
  const raw = (body.text ?? "").toString().trim();
  if (!raw) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (raw.length > 2000) {
    return NextResponse.json({ error: "keep requests under 2000 characters" }, { status: 400 });
  }

  const formatted = await formatFeedback(raw);
  // Author = the real USER (admin needs to know who to talk to), with the
  // character in parentheses for context — not the character name alone.
  const characterName = body.authorName ? String(body.authorName).slice(0, 40) : "";
  const authorName = `${user.displayName || user.email || "anonymous"}${
    characterName && characterName !== user.displayName ? ` (as ${characterName})` : ""
  }`.slice(0, 80);
  const request = FeatureRequest.parse({
    id: `fr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    campaignId: body.campaignId ? String(body.campaignId) : undefined,
    authorName,
    authorId: isDevUser(user) ? undefined : user.id,
    raw,
    ...formatted,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  await saveRequest(request);
  return NextResponse.json({ request });
}

/** PATCH /api/feedback { id, status, note? } — approve/decline/done (admin). */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const status = FeedbackStatus.safeParse(body.status);
  if (!body.id || !status.success) {
    return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  }
  const updated = await decideRequest(
    String(body.id),
    status.data,
    body.note ? String(body.note) : undefined,
  );
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ request: updated });
}
