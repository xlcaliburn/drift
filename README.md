# DRIFT

A shared-world, AI-narrated space-opera TTRPG webapp. A deterministic game
engine rolls every die; a cheap LLM narrator tells the story; friends play
characters embedded in rival factions of one persistent universe.

- **[drift/](drift/)** — the app (Next.js + TypeScript). See [drift/README.md](drift/README.md) for setup.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — why it's built this way (token economics, engine/narrator split).
- **[IMPLEMENTATION.md](IMPLEMENTATION.md)** — milestone-by-milestone build plan.
- **[MULTIPLAYER.md](MULTIPLAYER.md)** — the shared-world season design: factions, dossiers, relationship ledgers.

## Quick start

```bash
cd drift
npm install
cp .env.example .env.local   # add DEEPSEEK_API_KEY (cheapest) or ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000 → "+ Create a character"
```

`npm test` runs the 59-test engine suite — no API keys needed.
