import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cookie-bound Supabase client for server components and route handlers.
 * Used ONLY for auth calls (getUser, exchangeCodeForSession, signOut) — all
 * table access stays on the service client (db/queries.getServiceClient).
 *
 * Next 15: cookies() is async. setAll is try/caught because server components
 * can't write cookies — token refresh is middleware's job (middleware.ts).
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a server component — safe to ignore; middleware
            // refreshes sessions.
          }
        },
      },
    },
  );
}
