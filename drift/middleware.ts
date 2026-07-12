import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh + login redirect. Refreshes the Supabase auth token on every
 * page request and bounces unauthenticated visitors to /login.
 *
 * Deliberately does NO database reads: approved/suspended gating happens in
 * pages and route handlers (lib/auth.ts). API routes are excluded — they
 * return JSON 401/403s themselves.
 */
export async function middleware(request: NextRequest) {
  // Keyless local dev: no Supabase configured → no auth, pass everything.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresh the token (must be called before any redirect decision).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Pages only: skip Next internals, static files, API routes (self-guarded),
  // the auth callback/signout endpoints, and the login page itself.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api|auth|login|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
