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
| **Watch instead of playing** — a live scoreboard while the round runs | ❌ | ✅ |
| **Manage rooms** — see every open room and close it | ❌ | ✅ |

### Admins watch, players play

An admin never has to join a team. Create a room and you are a spectator: the lobby shows the host settings, and the moment the round starts your screen becomes a **live scoreboard** — a card per team counting correct answers as they land, plus a running feed of who just answered what. Join a team from the lobby if you would rather play.

Teams belong to the players. Creating a room no longer asks anyone to name one; the first player in is asked to create the first team, and everyone after can join it or start their own. A round will not start until at least one team exists with somebody on it.

### Manage rooms

`/rooms` lists every open room with its state, how many people are in it, its teams and rounds played, and closes any of them.

**Closing a room there is the only thing in this app that destroys a room.** Nothing expires: rooms carry no lifetime, no idle timeout and no storage TTL, and an empty room keeps its code, teams and scores until an admin closes it. If everyone leaves and comes back an hour later, the same code still works and the first person back becomes host.

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

## Scale

Sized for about **50 players plus 10 judges in one room**, and tested at that size against two server instances sharing one Redis — the shape Vercel actually runs, where consecutive requests from the same person land on different instances.

Three things make that work:

- **A cross-instance lock.** Every write to a room takes a Redis lock first. Without it two players answering at the same moment read the same room and write back over each other, and one answer silently disappears. The in-process lock alone cannot see other instances.
- **Scores are counters, not a replay.** Each answer increments a per-team tally, so scoring is exact however long a round runs. The answer log is display-only and capped, which keeps the room document small (16 KB after 600 answers) instead of growing without bound.
- **Polls do not write.** Reading a room persists nothing. Presence is refreshed at most every 15 seconds and never during a round, so the hot path is one read.

Measured at 50 players + 10 judges (see the numbers in the commit history):

| | |
| --- | --- |
| Human pace (~5 answers/s) | answer p95 **74 ms**, judge poll p95 **25 ms** |
| Sustained burst (52 answers/s) | 600/600 answers counted, none lost, none rejected |
| Room document | 16 KB with 600 answers recorded |

One thing to watch: a busy game is chatty with Redis. Measured with all 60 browsers polling exactly as the real UI does, a room uses about **3,400 commands a minute in the lobby and 6,300 a minute during a round** — most of it polling. A game night of ~30 minutes in the lobby and ~20 minutes of rounds comes to roughly **230,000 commands**. Upstash's free tier is 500,000 commands a month, so that is about two such evenings a month before you hit the ceiling.

Free-tier databases are also archived when idle: Upstash after 30 days without activity (data is backed up and restorable), Turso after 10 days (manual unarchive). Keep your questions in a file you can re-import (Export JSON on the Question Bank page) so an archived database never costs you them.

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

| Driver | When it is used | Durable? |
| --- | --- | --- |
| `redis` | Upstash / Vercel KV REST credentials are present | ✅ Survives restarts **and** is shared by every serverless instance. The production answer. |
| `file` | no Redis, but the filesystem is writable (local dev, Docker, any long-lived Node host) | ✅ Survives restarts. Single-server only. |
| `memory` | nothing else is available | ❌ Lost on every restart or redeploy. |

The driver is picked automatically in that order. **Vercel's filesystem is read-only**, so a Vercel deploy with no Redis lands on `memory` — rooms and the question bank then reset on every cold start, and requests hitting different instances will see "room not found" or scores that disagree. The Question Bank page tells you which driver is live.

**The app has a page for this: open `/setup` on your deployment.** It runs a live read/write test, names which environment variables it found, and walks through the fix. Re-test from the same page after redeploying.

The fastest route:

1. Vercel project → **Storage** → **Create Database** → **Upstash for Redis** (free plan). Vercel connects it and injects the credentials.
2. Project → **Settings** → **Environment Variables** — confirm a URL and a token are present under `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_URL` + `KV_REST_API_TOKEN` (`REDIS_REST_*` and `STORAGE_REST_*` are accepted too). The URL must be the **`https://` REST endpoint** — a `redis://` connection string is a different protocol and will not work.
3. **Redeploy.** Variables are read at boot, so a running deployment keeps its old values.

Doing it by hand instead: create the database at [upstash.com](https://upstash.com) and copy its REST URL and REST token from the database page into those variables.

`/api/health` returns the same information as JSON, including the result of a real round-trip against the store — so a wrong token shows up as a clear failure rather than as 500s mid-game.

### The question bank is a database, not a fixture

Once an admin builds the bank it stays put: it is stored under its own key and is never re-seeded. The three starter categories only appear when the store is completely empty, and deleting them is permanent — they do not grow back.

Whether that survives a **restart** depends on the driver above. On Vercel that means: configure Redis, or the bank resets on every cold start.

Either way the Question Bank page has **Export JSON** / **Import JSON**:

- *Export* downloads the whole bank as a portable file — a backup, or a way to move a set of questions to another deployment.
- *Import* asks whether to **replace** the bank with the file or **merge** it in. Merging never duplicates: a category that already exists is topped up, and questions already present are skipped.

The import is liberal about shape (each category's `items` may be plain strings or `{ "text": … }` objects, ids are regenerated) and validates before writing, so a malformed file is rejected without touching what you already have.

Local runs keep the file store in `.data/charade.json` (git-ignored). Point `CHARADE_DATA_DIR` somewhere else to move it, or set `CHARADE_DISABLE_FILE_STORE=1` to force the memory driver.

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
  rules.ts                   Pure game rules, no storage
  game.ts                    Store-backed layer over rules (bank + room persistence)
  admin.ts                   Password check and HMAC-signed admin tokens
  store.ts                   KV store (redis / file / memory drivers + in-process write lock)
  serialize.ts               The room view sent to clients (the deck never leaves the server)
  types.ts, ui.ts, client.ts Types, shared constants, fetch helpers
```

Sync is plain HTTP polling (~0.9s during a round, ~1.6s in the lobby) — no WebSockets, so it runs as-is on Vercel's serverless runtime.
