# 🎭 Charade Party

A multiplayer charades game for the browser, built to deploy on Vercel.

- **Question Bank** — create your own categories, drop questions into each one; at game time every selected category is **shuffled into a single deck**.
- **Dashboard** — several people sign in by name into the same room, split into teams, race a shared countdown, and see team scores settle on a dashboard.
- **Play** — a big question card plus two buttons, **✓ Correct** and **⏭ Skip**, with a countdown the admin decides.

## Roles

| | Normal player | Admin |
| --- | --- | --- |
| Pick a name on the home page | ✅ | ✅ |
| Join a room by code | ✅ | ✅ |
| Join or create a team, change their own name | ✅ | ✅ |
| **Create a room** | ❌ | ✅ |
| **Edit the Question Bank** (categories and questions) | ❌ | ✅ |
| **See and change Host settings** (countdown, categories, teams in play, skip penalty, start/end/reset) | ❌ | ✅ |
| Remove a player or delete a team | ❌ | ✅ |

Admin is unlocked on the home page: hit `🔒 Admin`, type the password, and the browser keeps an HMAC-signed token for 12 hours. The server checks that token on every privileged action, so hiding the panel is not the security boundary. Set `ADMIN_PASSWORD` before sharing the link — it defaults to `charade`.

## How a game goes

1. Anyone opens the home page → `📚 Question Bank` → create categories (Animals / Movies / Idioms…) → paste questions in bulk (one per line; commas work too).
2. An admin enters their name → `Create room`. They get a 4-character room code and an invite link.
3. Friends open the same site, type the code (or click the invite link), and enter a name.
4. **Teams are made inside the room.** The first person in has no team to join, so the room asks them to name one and drops them into it. Everyone after that can join an existing team or start their own.
5. In the lobby the admin sets the **countdown** (30/60/90/120/180s presets, or anything from 15 to 600 seconds), ticks which **categories** are in play, marks each **team** as In or Out for this round, and chooses whether skipping costs a point.
6. Admin hits `🚀 Start game` — everyone on an In team plays at once, drawing from the same mixed deck, so **nobody sees the same question twice**. Players on an Out team watch the live scores instead.
7. When time runs out the round settles automatically (the admin can also end it early). The dashboard shows scores per team, correct/skipped counts, and the full answer log. `🔁 Play again` keeps a running overall total.

Scoring: correct `+1`, skip `0` (the admin can turn on "skips cost 1 point"). Points go to the player's **team**.

## Room lifetime

A room shuts itself down **3 hours after it was created**, and immediately once the **last player leaves**. `Leave game` in the room header takes you back to the home page at any point — lobby, mid-round or on the dashboard. Reopening a closed room shows a "this room is closed" page rather than a broken lobby.

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

### Set the admin password

`ADMIN_PASSWORD` is an **environment variable** — it is never committed to the repo. Set it in two places:

**Locally** — create a `.env.local` file in the project root (already git-ignored):

```bash
cp .env.example .env.local
# then edit .env.local
ADMIN_PASSWORD=something-only-you-know
```

Restart `npm run dev` afterwards; Next.js reads `.env.local` at boot.

**On Vercel** — the dashboard, or the CLI:

- *Dashboard*: your project → **Settings** → **Environment Variables** → add `ADMIN_PASSWORD`, tick the environments you want (Production / Preview / Development) → **Save**. Then **redeploy** — running deployments keep the values they were built with.
- *CLI*: `vercel env add ADMIN_PASSWORD production` (repeat per environment), then `vercel --prod`.

Never put the password in `.env` or any committed file. If it leaks, change it and redeploy: every admin token in circulation stops working immediately, because the signing key is derived from the password.

Optionally set `ADMIN_SECRET` too if you want the signing key to be independent of the password.

**Until you set it, the password is `charade`.** Anyone who knows that can create rooms and edit the question bank, so change it before sharing the link.

### ⚠️ Configure Redis for production (important)

Game state (prompt bank, rooms, scores) goes through a swappable KV layer:

| Driver | When it is used | Notes |
| --- | --- | --- |
| `memory` | default | Zero config, great for local dev and quick demos. State lives in the Node process: lost on restart, and **not shared between serverless instances**. |
| `redis` | when REST env vars are present | Every instance shares one copy of the state. This is what you need for real multi-device play. |

On Vercel with only the memory driver, requests can land on different instances and you will see "room not found" or scores that disagree.

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
  page.tsx                   Home: sign in, unlock admin, create or join a room
  questions/page.tsx         Question Bank: categories and questions
  room/[code]/page.tsx       Room page (team gate / lobby / play / dashboard)
  room/[code]/RoomClient.tsx All room interaction and polling
  api/admin/route.ts         Password → signed admin token
  api/bank/route.ts          Question bank read/write
  api/rooms/route.ts         Create a room (admin only)
  api/rooms/[code]/route.ts  Room polling + every room action
  api/health/route.ts        Which store driver is active
lib/
  game.ts                    Rooms, teams, bank, dealing, scoring, lifetime
  admin.ts                   Password check and HMAC-signed admin tokens
  store.ts                   KV store (memory / redis drivers + in-process write lock)
  serialize.ts               The room view sent to clients (the deck never leaves the server)
  types.ts, ui.ts, client.ts Types, shared constants, fetch helpers
```

Sync is plain HTTP polling (~0.9s during a round, ~1.6s in the lobby) — no WebSockets, so it runs as-is on Vercel's serverless runtime.
