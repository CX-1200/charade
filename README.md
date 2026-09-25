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

An admin never has to join a team. Create a room and you are a spectator: the lobby shows the host settings, and the moment the round starts your screen becomes a **live race board**, built to be put on a big screen: a card per team with its progress (`7/20`), streak badges, and a feed of who scored — **never the questions themselves**, since other teams are still acting out the same ones. Join a team from the lobby if you would rather play.

Teams belong to the players. Creating a room no longer asks anyone to name one; the first player in is asked to create the first team, and everyone after can join it or start their own. A round will not start until at least one team exists with somebody on it.

### Manage rooms

`/rooms` lists every open room with its state, how many people are in it, its teams and rounds played, and closes any of them.

**Closing a room there is the only thing in this app that destroys a room.** Nothing expires: rooms carry no lifetime, no idle timeout and no storage TTL, and an empty room keeps its code, teams and scores until an admin closes it. If everyone leaves and comes back an hour later, the same code still works and the first person back becomes host.

Admin is unlocked on the home page: hit `🔒 Admin`, type the password, and the browser keeps an HMAC-signed token for 12 hours. The server checks that token on every privileged action, so hiding the panel is not the security boundary. Set `ADMIN_PASSWORD` before sharing the link — it defaults to `charade`.

## How a game goes

1. An admin opens `📚 Question Bank` and adds categories and questions — typed in on the page, or kept in a spreadsheet and imported as CSV (see [The question bank](#the-question-bank)).
2. An admin enters their name → `Create room`. They get a 4-character room code and an invite link.
3. Friends open the same site, type the code (or click the invite link), and enter a name.
4. **Teams are made inside the room.** The first person in has no team to join, so the room asks them to name one and drops them into it. Everyone after that can join an existing team or start their own.
5. In the lobby the admin sets the **countdown** (30/60/90/120/180s presets, or anything from 15 to 600 seconds), ticks which **categories** are in play, marks each **team** as In or Out for this round, and chooses whether skipping costs a point.
6. Admin hits `🚀 Start game`. Every screen shows **Get ready… 3, 2, 1**, then it's a **race**: every In team works through its own shuffle of the *same* questions. Each player on a team holds a different card; a **skipped card goes to the bottom of the team's deck** and comes back later, so a team only finishes by getting every question right. Players on an Out team watch the race instead.
7. **The first team to finish is shown as the winner on every screen — but the round keeps going** for everyone else, so second and third place are still up for grabs. A finished team's players see their place and time instead of a card.
8. The round ends when the clock runs out, when the admin presses End now, or on its own once every team has finished. The results show each team's **place and the time it took** (finishers: time to answer everything; the rest: the time they played, and how far they got), best streak, points per team, and the full answer log with the words revealed. `🔁 Play again` keeps a running overall total.

Streaks: correct answers in a row, per team, reset by a skip. `🔥 On Fire!` at 3, `⚡ Unstoppable!` at 5, `👑 Legendary!` at 8, `🌟 Godlike!` at 12 — each flashes across the live board as it is reached.

Scoring: correct `+1`, skip `0` (the admin can turn on "skips cost 1 point"). Points go to the player's **team**. In the round ranking, finishers come first in finishing order; everyone else by points.

### Player credentials

Each player has two values. The **player ID** is public — every screen in the room receives it, because that is how players are listed and how an admin points at someone to remove them. The **player secret** is a random 192-bit **bearer token** handed only to that player's browser when they join, and every action taken as that player (answering, changing team, leaving) must present it. So seeing someone's ID lets you do nothing as them.

The server stores only a **SHA-256 hash** of each secret and compares in constant time. Browsers send credentials in request **headers**, never in the URL, since URLs end up in logs and history. Players who joined before this existed simply rejoin once under the same name and take their old place back.

## Scale

Sized for about **50 players plus 10 judges in one room**, and tested at that size against two server instances sharing one database — the shape Vercel actually runs, where consecutive requests from the same person land on different instances. Tested on every driver: a real libSQL server over HTTP with JWT auth (what Turso runs), a local libSQL file, Redis, and the single-server file store.

What makes that work:

- **A cross-instance lock.** Every write to a room takes a lock in the database first. Without it two players answering at the same moment read the same room and write back over each other, and one answer silently disappears. The in-process lock alone cannot see other instances.
- **Scores are counters, not a replay.** Each answer increments a per-team tally, so scoring is exact however long a round runs. The answer log is display-only and capped, which keeps the room document small (16 KB after 600 answers) instead of growing without bound.
- **Polls do not write.** Reading a room persists nothing. Presence is refreshed at most every 15 seconds and never during a round, so the hot path is one read — and polls for the same room on one server share that read for 750 ms.
- **Each screen polls only as fast as it needs to.** A player mid-round gets their next card back from their own answer and runs the clock locally, so they poll every 5 s just to notice an early finish. The judges' live scoreboard polls every 1.5 s; the lobby and results every 3 s; a hidden tab every 15 s.
- **A 4-second lead-in.** Because the lobby polls every few seconds, screens learn about a start at different moments. Rounds therefore begin 4 s after the admin presses Start — longer than the slowest poll — and cards are held back until then, so everyone starts answering within a few milliseconds of each other.

Measured at 50 players + 10 judges, two instances sharing one libSQL server over HTTP:

| | |
| --- | --- |
| Human pace (~5 answers/s) | answer p95 **64 ms**, judge poll p95 **40 ms** |
| Sustained burst | 600/600 answers counted, none lost, none rejected |
| Start of a round | every player able to answer within **54 ms** of each other |
| Room document | 17 KB served with 600 answers recorded; team decks are stored as indexes, not copies |

### Database usage

Measured with all 60 browsers polling exactly as the UI does:

| | Lobby | During a round |
| --- | --- | --- |
| Reads per minute | ~540 | ~940 |
| Writes per minute | ~390 | ~1,460 |

A game night of ~30 minutes in the lobby and ~20 minutes of rounds is about **35,000 reads and 41,000 writes**.

- **Turso free plan** — 500 million reads and 10 million writes a month: roughly **240 such game nights a month** before writes run out. This app will not exhaust it.
- **Upstash free plan** — 500,000 commands a month, and every read and write is a command: roughly **6 game nights a month**.

### ⚠️ Configure a database for production (important)

Rooms, scores and the question bank live behind a swappable key/value layer. The driver is picked automatically, in this order:

| Driver | When it is used | Durable? |
| --- | --- | --- |
| `turso` | `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` are set | ✅ Hosted SQLite, shared by every serverless instance. Free tier large enough that you will never pay. **Recommended.** |
| `redis` | Upstash / Vercel KV REST credentials are set | ✅ Also shared and durable, but the free tier is tight for busy game nights. |
| `file` | no database, but the disk is writable (local dev, Docker, a long-lived Node host) | ✅ Survives restarts. One server only. |
| `memory` | nothing else is available | ❌ Lost on every restart or redeploy. |

**Vercel's filesystem is read-only**, so a Vercel deploy with no database lands on `memory`: requests hitting different instances see "no such room", and the question bank resets on every cold start.

**Open `/setup` on your deployment.** It runs a live read/write test against the store, names the environment variables it found (names only, never values), and walks through the fix. It also calls out the likely mistakes by name: a wrong or expired token, a URL that cannot be reached, a database URL with no token beside it, and a `redis://` URL where an `https://` REST endpoint belongs.

#### Setting up Turso (free, no card)

1. Sign up at [turso.tech](https://turso.tech) and create a database in the region closest to your Vercel project. (Or from Vercel: project → **Storage** → **Create Database** → **Turso**, which injects the variables for you.)
2. Vercel project → **Settings** → **Environment Variables**:
   - `TURSO_DATABASE_URL` — the database URL, starting with `libsql://`
   - `TURSO_AUTH_TOKEN` — from the database page, **Generate Token**
3. **Redeploy** — variables are read at boot. Then check `/setup`.

The database's tables are created on first use, and the question bank loads itself from the repository copy (below), so there is nothing else to set up. If Redis variables are also set, Turso takes priority, so you can switch by adding the two variables.

#### Keep the free database awake

Free tiers archive databases nobody touches — Turso after 10 days, Upstash after 30 — and Turso does not wake up on its own: the app would be down until you unarchive it by hand. `vercel.json` registers a daily Vercel Cron job that calls `/api/keepalive`, which does one real read and write, so the database never counts as idle.

Set `CRON_SECRET` in Vercel's environment variables (any long random string). Vercel then sends it with the cron request and the endpoint refuses everyone else, so strangers cannot spend your free-tier writes.

#### Moving your questions from Upstash to Turso

Before switching: on the current deployment, Question Bank → **Export CSV**, and upload it over `data/questions.csv` in the repository. After adding the Turso variables and redeploying, the new, empty database loads that file automatically.

### The question bank

**Day to day, edit on the site.** Question Bank → add categories and questions. Changes are live immediately — no deploy.

**Or edit in a spreadsheet.** **Export CSV** gives a file with two columns, `category` and `question`, one question per row, that opens cleanly in Excel, Numbers or Google Sheets. Edit it and **Import CSV**: you see how many questions and categories are in the file before anything is written, then choose **Merge in** (adds what is new, never duplicates) or **Replace everything**. The import copes with what spreadsheets actually produce — a byte-order mark, `;` or tab separators, quoted cells with commas, blank rows, columns in any order, headers in English or Chinese (`分类` / `题目`), or no header at all.

**The permanent copy lives in the repository** as `data/questions.csv`. It ships with every deploy, and:

- **An empty database loads it automatically** — a fresh Turso database, one restored after archiving, a move between providers.
- **Deploys never overwrite the questions you edit on the site.** The stored bank always wins; the file is only read when the database has no bank at all. This is deliberate: it is what stops an update from wiping your questions.
- **Restore from repository** (on the Question Bank page) loads it on demand — replacing the bank, or merging into it.

To update the permanent copy: **Export CSV**, then on GitHub open `data/questions.csv` and upload the new file over it. Git keeps every earlier version, so a bad edit can always be rolled back.

Older JSON exports still import.

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
  rooms/page.tsx             Manage rooms (admin)
  setup/page.tsx             Live storage diagnosis and setup steps
  api/admin/route.ts         Password → signed admin token
  api/admin/rooms/route.ts   List and close rooms (admin)
  api/bank/route.ts          Question bank read/write, CSV import, restore from repo
  api/rooms/route.ts         Create a room (admin only)
  api/rooms/[code]/route.ts  Room polling + every room action
  api/health/route.ts        Which store driver is active, plus a live round-trip
  api/keepalive/route.ts     Daily touch so a free database is never archived
lib/
  rules.ts                   Pure game rules, no storage
  game.ts                    Store-backed layer over rules (bank, rooms, repo backup)
  csv.ts                     Spreadsheet import/export, shared by browser and server
  admin.ts                   Password check and HMAC-signed admin tokens
  store.ts                   KV store: turso / redis / file / memory drivers + locking
  auth.ts                    Player secrets: issue, hash, verify
  serialize.ts               The room view sent to clients (the deck never leaves the server; questions hidden from the feed mid-round)
  types.ts, ui.ts, client.ts Types, shared constants, fetch helpers
data/
  questions.csv              The question bank's permanent copy
vercel.json                  The daily keep-alive cron
```

Sync is plain HTTP polling — no WebSockets, so it runs as-is on Vercel's serverless runtime.
