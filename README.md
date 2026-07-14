# DRIFT

A shared-world, AI-narrated space-opera TTRPG webapp. A deterministic game
engine rolls every die; a cheap LLM narrator tells the story; friends play
characters embedded in rival factions of one persistent universe.

- **[drift/](drift/)** — the app (Next.js + TypeScript). See [drift/README.md](drift/README.md) for setup.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — why it's built this way (token economics, engine/narrator split).
- **[IMPLEMENTATION.md](IMPLEMENTATION.md)** — what's left to build, in rough order.
- **[MULTIPLAYER.md](MULTIPLAYER.md)** — the shared-world design: dossiers, relationship ledgers, seasons.

## Quick start

```bash
cd drift
npm install
cp .env.example .env.local   # add DEEPSEEK_API_KEY (cheapest) or ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000 → "+ Create a character"
```

`npm test` runs the engine suite — no API keys needed.

With the Supabase env vars set, the app requires **Google sign-in**: new
accounts wait for approval, players see only their own campaigns, and per-user
monthly token budgets are enforced. The owner manages users, spend, and feature
requests at `/admin`. Setup steps: [drift/README.md](drift/README.md).
