import GoogleSignIn from "@/components/GoogleSignIn";

/** Sign-in gate. Middleware sends every unauthenticated page request here. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 pb-24">
      <h1 className="text-4xl font-bold tracking-tight text-accent">DRIFT</h1>
      <p className="mt-2 text-sm text-neutral-400">
        A brutal space-opera TTRPG. The engine rolls the dice; the narrator tells the story.
      </p>

      <div className="mt-8 rounded-lg border border-edge bg-panel/50 p-6">
        <GoogleSignIn />
        <p className="mt-4 text-xs text-neutral-500">
          New accounts start pending — the game master approves you before you can play.
        </p>
        {params.error === "oauth" && (
          <p className="mt-3 text-sm text-bad">Sign-in failed — try again.</p>
        )}
      </div>
    </main>
  );
}
