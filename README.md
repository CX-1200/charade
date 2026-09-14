# 🎭 Charade Party

A multiplayer charades game for the browser, built to deploy on Vercel.

- **Write prompts** — create your own categories, drop prompts into each one; at game time every selected category is **shuffled into a single deck**.
- **Dashboard** — several people sign in by name into the same room, split into teams, race a shared countdown, and see team scores settle on a dashboard.
- **Play** — a big prompt card plus two buttons, **✓ Correct** and **⏭ Skip**, with a countdown the host decides.

## How a game goes

1. Anyone opens the home page → `📚 Prompt bank` → create categories (Animals / Movies / Idioms…) → paste prompts in bulk (one per line; commas work too).
2. Back home, enter your name → `Create room`. You get a 4-character room code and an invite link.
3. Friends open the same site, type the code (or click the invite link), enter a name, land in the lobby, and pick a team.
4. In the lobby the host sets the **countdown** (30/60/90/120/180s presets, or anything from 15 to 600 seconds), which **categories** are in play, the **teams**, and whether skipping costs a point.
5. Host hits `🚀 Start game` — everyone plays at once. Each player draws from the same mixed deck, so **nobody sees the same prompt twice**.
6. When time runs out the round settles automatically (the host can also end it early). The dashboard shows scores per team, correct/skipped counts, and the full answer log. `🔁 Play again` keeps a running overall total.

Scoring: correct `+1`, skip `0` (the host can turn on "skips cost 1 point"). Points go to the player's **team**.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts: `npm run build`, `npm run start`, `npm run typecheck`.

## Deploy to Vercel

```bash
npm i -g vercel
vercel            # first deploy — accept the defaults
vercel --prod     # promote to production
```

Or push the repo to GitHub and import it at [vercel.com/new](https://vercel.com/new) — Next.js is detected automatically, no build settings to change.

### ⚠️ Configure Redis for production (important)

Game state (prompt bank, rooms, scores) goes through a swappable KV layer:

| Driver | When it is used | Notes |
| --- | --- | --- |
| `memory` | default | Zero config, great for local dev and quick demos. State lives in the Node process: lost on restart, and **not shared between serverless instances**. |
| `redis` | when REST env vars are present | Every instance shares one copy of the state. This is what you need for real multi-device play. |

On Vercel with only the memory driver, requests can land on different instances and you will see "room not found" or scores that disagree. The home page shows a warning when it detects this.

Pick either (both have a free tier):

- **Upstash Redis** — create a Redis database at [upstash.com](https://upstash.com) and put the REST URL and token into your Vercel environment variables:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- **Vercel KV / Vercel Redis** — create it from the project's Storage tab. It injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which this code reads as well.

Redeploy after setting the variables. Hit `/api/health` to confirm which driver is live.

Rooms carry a 12-hour TTL and clean themselves up.

## Design

Two brand colours run the whole UI: warm cream `#e0dace` as the ground and signal red `#de2c00` for every primary action, the leading team, the live progress bar and the low-time warning. Everything else is ink on cream.

## Project layout

```
app/
  page.tsx                   Home: sign in, create or join a room
  questions/page.tsx         Prompt bank: categories and prompts
  room/[code]/page.tsx       Room page (lobby / play / dashboard)
  room/[code]/RoomClient.tsx All room interaction and polling
  api/bank/route.ts          Prompt bank read/write
  api/rooms/route.ts         Create a room
  api/rooms/[code]/route.ts  Room polling + every room action
  api/health/route.ts        Which store driver is active
lib/
  game.ts                    Rooms, bank, dealing, scoring
  store.ts                   KV store (memory / redis drivers + in-process write lock)
  serialize.ts               The room view sent to clients (the deck never leaves the server)
  types.ts, ui.ts, client.ts Types, shared constants, fetch helpers
```

Sync is plain HTTP polling (~0.9s during a round, ~1.6s in the lobby) — no WebSockets, so it runs as-is on Vercel's serverless runtime.
