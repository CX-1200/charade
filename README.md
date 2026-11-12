# 👑 Best Dress Vote

Live voting for **Best Dress — King** and **Best Dress — Queen**, run as a show: the admin steps through it and every guest's phone and the big screen follow.

## Who sees what

- **The site is off until the admin opens a session.** Anyone who opens it before then — or later without the session's QR code — sees a holding page with the event's name and nothing to tap. They are "uninvited": the server gives them no state, no device id, and refuses their votes.
- **Guests** join by scanning the QR code the admin shows (it carries the session id). Their one page (`/`) follows the show; there are no tabs.
- **The admin** unlocks with the faint lock at the far right of the top bar. The admin view has two tabs:
  - **Live** (`/live`) — for the projector. No controls and no QR code; it shows each step, including the countdown.
  - **Manage** (`/manage`) — the session and its join QR (with a full-screen QR to project), **The show**, the nominee lists, **Reset votes** per vote, voting rules and passes.

Hiding tabs is a courtesy, not the protection: every admin request needs a password-issued token, and every vote needs the current session id.

## Running the show

1. Unlock, paste the nominees for King and Queen (one per line, optional note after `|`), and pick the voting rules.
2. **Open session** → a QR code appears. Show it (full screen on the projector, or on your phone); guests scan to join. **Turn off** ends the session and sends everyone back to the holding page; a new session gets a new QR code.
3. Put **Live** on the projector, then press the button in **The show** for each step:

| Admin presses | Guests' phones | Live screen |
|---|---|---|
| (start) | Event title, waiting | Title and the nominees gliding by |
| Open voting for King | King's list, "voting starts soon" | King's list |
| Start King voting (choose the countdown: 30 s – 5 min) | Pick one name → confirm ("only one, can't change") → live count | Countdown + live count |
| — countdown reaches 0:00 (or **Stop now**) | Votes lock; the winner, or everyone tied | Result, revealed bar by bar |
| Open voting for Queen → Start Queen voting | Same as King | Same as King |
| Show both winners | Best Dress — King & Queen | Best Dress — King & Queen |

Guests who voted, or whose countdown ran out, switch to the live count automatically. **Back** steps back if you press too early (votes already cast are kept). Every closing or destructive action asks for confirmation.

## One vote per person

There are no logins, so "one person" has to be tied to something the person holds. The app offers two rules (chosen in Manage, before voting starts):

| Rule | How it works | Stops | Doesn't stop |
| --- | --- | --- | --- |
| **One vote per phone** (default) | Everyone scans the session's join QR. The server gives each browser a random id, kept in an httpOnly cookie *and* in localStorage — clearing one restores it from the other. | Voting twice from the same browser; clearing cookies; reloading; scripted votes without a device | A private/incognito window, or a second phone |
| **One vote per voting pass** | Guests join with the session QR as usual, and also hold a printed pass (scan its QR or type its code); each code votes once for King and once for Queen, on whichever phone uses it. Codes are 8 characters (~850 billion combinations) and wrong guesses are rate-limited. | Everything above, including incognito and second phones | Someone handing their pass to someone else |

**Why not block by IP address?** At a venue everyone is on the same Wi-Fi, and mobile carriers put thousands of phones behind one IP — so an IP rule would block real guests long before it stopped a cheat. IPs are used only to rate-limit *wrong* passwords and pass codes; correct votes are never limited (tested: 300 phones on one IP voting at once, all counted).

Other ways people do this, and why they're not built in: SMS/email one-time codes (cost money and slow guests down), "Sign in with Google" (friction, and not everyone has it on hand), browser fingerprinting (unreliable — identical iPhones look the same — and a privacy problem). If you need it stricter than passes, check names against a guest list at the door when handing out passes.

## Security

- Admin: one password (`ADMIN_PASSWORD`) → a signed 12-hour token, checked on every admin action. No default password in production; 10 wrong passwords from one address lock it out for 15 minutes. Use a different password from any other app.
- Outside the session the API gives only the event title. Inside it, titles, nominees and counts — never who voted for whom, the pass codes or the session id.
- The countdown is enforced on the server: once it ends, the vote is closed and further votes are refused, whatever a phone's clock says.
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
  page.tsx                    Guest phones: holding page, or the show
  live/page.tsx               Live screen (admin, projector)
  manage/page.tsx             Admin: session + QR, the show, nominees, rules, passes
  passes/page.tsx             Printable voting passes
  api/state/route.ts          State for admin / session guests, holding view for others
  api/vote/route.ts           Cast a vote (session guests, before the countdown ends)
  api/admin/route.ts          Password → admin token
  api/admin/election/route.ts Admin read + actions
  api/health, api/keepalive   Store check; daily keep-alive cron
lib/
  election.ts                 Storage, the show's steps, countdown lock, sessions
  voter.ts                    Who is voting: device id or pass code
  view.ts                     What each screen may see
  store.ts                    KV store: turso / redis / file / memory + locking
  admin.ts, ratelimit.ts      Admin tokens; wrong-guess limits
  http.ts, errors.ts          Shared API responses
components/
  Show.tsx                    The scenes, shared by phones and the Live screen
  useLiveState.ts             Polling, server clock, countdown
  ...                         Top bar, QR, confirm dialog, admin unlock
```
