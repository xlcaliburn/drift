import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** POST /auth/signout — clears the session cookie and returns to /login. */
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${req.nextUrl.origin}/login`, { status: 303 });
}
