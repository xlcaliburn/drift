import Link from "next/link";
import { DEFAULT_CAMPAIGN_ID } from "@/lib/state";
import { campaign, vess } from "@/scripts/seedData";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight text-accent">DRIFT</h1>
      <p className="mt-2 text-edge-foreground text-sm text-neutral-400">
        A brutal space-opera TTRPG. The engine rolls the dice; the narrator tells the story.
      </p>

      <Link
        href="/create"
        className="mt-8 block rounded-lg border border-accent/60 bg-accent/10 p-5 transition hover:bg-accent/20"
      >
        <div className="text-lg font-semibold text-accent">+ Create a character</div>
        <p className="mt-1 text-sm text-neutral-400">
          Join the shared universe — pick a faction, shape who you are, forge a signature skill.
        </p>
      </Link>

      <div className="mt-8">
        <h2 className="text-xs uppercase tracking-widest text-neutral-500">Example campaign</h2>
        <Link
          href={`/play/${DEFAULT_CAMPAIGN_ID}`}
          className="mt-3 block rounded-lg border border-edge bg-panel p-5 transition hover:border-accent"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-semibold">{campaign.name}</span>
            <span className="text-xs text-neutral-500">{campaign.status}</span>
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            {vess.name} · ¢{vess.credits} · Goal: Lark buyout
          </p>
        </Link>
      </div>

      <div className="mt-10 flex items-center justify-between text-xs text-neutral-600">
        <span>
          Login (Google) and shared-world persistence land with the Supabase wiring. Set DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY) in .env.local to play.
        </span>
        <Link href="/requests" className="shrink-0 text-neutral-500 hover:text-accent">
          Feature requests →
        </Link>
      </div>
    </main>
  );
}
