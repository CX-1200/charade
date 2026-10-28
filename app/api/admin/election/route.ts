import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import {
  addNominees,
  clean,
  findNominee,
  hasVotes,
  isPollId,
  MAX_TICKETS,
  newTicketCode,
  readElection,
  removeNominee,
  resetVotes,
  updateElection,
} from '@/lib/election';
import { HttpError } from '@/lib/errors';
import { fail, readJson } from '@/lib/http';
import type { Election, PollId } from '@/lib/types';
import { adminView } from '@/lib/view';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    requireAdmin(request.headers.get('x-admin-token'));
    return NextResponse.json(adminView(await readElection()));
  } catch (error) {
    return fail(error);
  }
}

function pollOf(body: Record<string, unknown>): PollId {
  if (!isPollId(body.poll)) throw new HttpError(400, 'Unknown vote');
  return body.poll;
}

function apply(election: Election, body: Record<string, unknown>): string | null {
  switch (body.action) {
    case 'setTitle': {
      const title = clean(body.title, 60);
      if (!title) throw new HttpError(400, 'Please enter a title');
      election.title = title;
      return null;
    }
    case 'setPollTitle': {
      const title = clean(body.title, 60);
      if (!title) throw new HttpError(400, 'Please enter a title');
      election.polls[pollOf(body)].title = title;
      return null;
    }
    case 'addNominees': {
      const added = addNominees(election.polls[pollOf(body)], String(body.text ?? ''));
      if (!added) throw new HttpError(400, 'No new names found — one name per line');
      return `Added ${added} ${added === 1 ? 'nominee' : 'nominees'}`;
    }
    case 'updateNominee': {
      const nominee = findNominee(election.polls[pollOf(body)], body.nomineeId);
      const name = clean(body.name, 40);
      if (!name) throw new HttpError(400, 'A nominee needs a name');
      nominee.name = name;
      nominee.note = clean(body.note, 60);
      return null;
    }
    case 'removeNominee': {
      removeNominee(election, pollOf(body), body.nomineeId);
      return null;
    }
    case 'setStatus': {
      const poll = election.polls[pollOf(body)];
      const status = body.status;
      if (status === 'open') {
        if (!poll.nominees.length)
          throw new HttpError(400, 'Add the nominees before opening the vote');
        poll.status = 'open';
        poll.openedAt ??= Date.now();
        poll.closedAt = null;
      } else if (status === 'closed') {
        poll.status = 'closed';
        poll.closedAt = Date.now();
      } else {
        throw new HttpError(400, 'Unknown status');
      }
      return null;
    }
    case 'resetVotes': {
      const poll = election.polls[pollOf(body)];
      resetVotes(election, poll.id);
      poll.openedAt = poll.status === 'open' ? Date.now() : null;
      poll.closedAt = null;
      return 'Votes cleared';
    }
    case 'setMode': {
      if (body.mode !== 'device' && body.mode !== 'ticket')
        throw new HttpError(400, 'Unknown mode');
      if (body.mode === election.mode) return null;
      // Switching mid-vote would let someone vote once per mode.
      if (hasVotes(election)) {
        throw new HttpError(409, 'Votes are already in — reset both votes before changing this');
      }
      election.mode = body.mode;
      return null;
    }
    case 'generateTickets': {
      const count = Math.floor(Number(body.count));
      if (!Number.isFinite(count) || count < 1 || count > 500) {
        throw new HttpError(400, 'Make between 1 and 500 passes at a time');
      }
      if (Object.keys(election.tickets).length + count > MAX_TICKETS) {
        throw new HttpError(409, `At most ${MAX_TICKETS} passes in total`);
      }
      const now = Date.now();
      for (let made = 0; made < count; ) {
        const code = newTicketCode();
        if (election.tickets[code]) continue;
        election.tickets[code] = { code, createdAt: now, used: {} };
        made += 1;
      }
      return `Made ${count} voting ${count === 1 ? 'pass' : 'passes'}`;
    }
    case 'deleteUnusedTickets': {
      let removed = 0;
      for (const [code, ticket] of Object.entries(election.tickets)) {
        if (Object.keys(ticket.used).length) continue;
        delete election.tickets[code];
        removed += 1;
      }
      return `Deleted ${removed} unused ${removed === 1 ? 'pass' : 'passes'}`;
    }
    default:
      throw new HttpError(400, 'Unknown action');
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request.headers.get('x-admin-token'));
    const body = await readJson(request, 64_000);
    const { election, result } = await updateElection((draft) => apply(draft, body));
    return NextResponse.json({ ...adminView(election), message: result });
  } catch (error) {
    return fail(error);
  }
}
