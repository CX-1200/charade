# 👑 Best Dress Vote

Live voting for **Best Dress — King** and **Best Dress — Queen**. Guests scan a QR code, tap their pick, and the big screen updates as the votes come in.

- **Vote** (`/`) — the page a phone opens after scanning. Shows the vote that is open, one tap + confirm to vote, then "You voted for …". No counts here, so nobody follows the crowd.
- **Live** (`/live`) — for the big screen: the QR code to vote and every nominee's count, updating every 2 s. The leader of the vote in focus is the only thing in colour; when a vote closes, its winner is announced. Has a Full screen button.
- **Manage** (`/manage`, admin password) — event title, the two nominee lists, open / close / reopen each vote, reset votes, voting rules, and voting passes.
- **Passes** (`/passes`, admin) — a printable sheet of personal voting passes, cut along the dashed lines.

## Running an event

1. Open **Manage** and enter the admin password.
2. Paste the nominees for King and for Queen — one per line, with an optional note after a `|` (e.g. `Alex Tan | Table 4`).
3. Pick the **voting rules** (below). For passes: make one per guest, then **Print passes**.
4. Put **Live** on the big screen.
5. **Open voting** for King. Close it when you're done — the screen announces the winner. Then open Queen.

The two votes are independent: run them one after the other, or both at once.

## One vote per person

There are no logins, so "one person" has to be tied to something the person holds. The app offers two rules (chosen in Manage, before voting starts):

| Rule | How it works | Stops | Doesn't stop |
| --- | --- | --- | --- |
| **One vote per phone** (default) | Everyone scans the same QR. The server gives each browser a random id, kept in an httpOnly cookie *and* in localStorage — clearing one restores it from the other. | Voting twice from the same browser; clearing cookies; reloading; scripted votes without a device | A private/incognito window, or a second phone |
| **One vote per voting pass** | Each guest gets a printed pass with its own QR code; each code votes once for King and once for Queen, on whichever phone scans it. Codes are 8 characters (~850 billion combinations) and wrong guesses are rate-limited. | Everything above, including incognito and second phones | Someone handing their pass to someone else |

**Why not block by IP address?** At a venue everyone is on the same Wi-Fi, and mobile carriers put thousands of phones behind one IP — so an IP rule would block real guests long before it stopped a cheat. IPs are used only to rate-limit *wrong* passwords and pass codes; correct votes are never limited (tested: 300 phones on one IP voting at once, all counted).

Other ways people do this, and why they're not built in: SMS/email one-time codes (cost money and slow guests down), "Sign in with Google" (friction, and not everyone has it on hand), browser fingerprinting (unreliable — identical iPhones look the same — and a privacy problem). If you need it stricter than passes, check names against a guest list at the door when handing out passes.

## Security

- Admin: one password (`ADMIN_PASSWORD`) → a signed 12-hour token, checked on every admin action. No default password in production; 10 wrong passwords from one address lock it out for 15 minutes. Use a different password from any other app.
- The public API exposes titles, nominees and counts only — never who voted for whom, and never the pass codes.
- Votes are written one at a time under a lock (also across server instances), so simultaneous votes are never lost.
- Size-capped request bodies, generic server errors, and browser security headers (CSP, no framing, `nosniff`, referrer and permissions policies).

## Deploying on Vercel

This app lives on its own branch, so give it its **own Vercel project** (Add New → Project → the same repository), then in that project's Settings:

1. **Git → Production Branch**: `claude/best-dress-voting`. (Preview deployments are behind Vercel's login by default, so guests could not open one — it has to be the production deployment.)
2. **Environment Variables**: `ADMIN_PASSWORD`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `CRON_SECRET` — see `.env.example`. A separate Turso database is cleanest; sharing one with another app also works, since every key here starts with `vote:`.
3. Open `/api/health` on the deployment: it should say `"storeDriver":"turso"`.

## Local development

```
npm install
npm run dev        # admin password "bestdress" when ADMIN_PASSWORD is unset
```

Without a database configured, data is kept in `./.data/vote.json`.

## Project layout

```
app/
  page.tsx                    Vote (guest phones)
  live/page.tsx               Live dashboard (big screen)
  manage/page.tsx             Admin: nominees, open/close, rules, passes
  passes/page.tsx             Printable voting passes
  api/state/route.ts          Public state + device id (polled)
  api/vote/route.ts           Cast a vote
  api/admin/route.ts          Password → admin token
  api/admin/election/route.ts Admin read + actions
  api/health, api/keepalive   Store check; daily keep-alive cron
lib/
  election.ts                 Storage and voting rules
  voter.ts                    Who is voting: device id or pass code
  view.ts                     What each screen may see
  store.ts                    KV store: turso / redis / file / memory + locking
  admin.ts, ratelimit.ts      Admin tokens; wrong-guess limits
  http.ts, errors.ts          Shared API responses
components/                   Top bar, QR, confirm dialog, admin unlock
```
