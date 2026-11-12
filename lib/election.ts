import { randomBytes } from 'node:crypto';
import { HttpError } from './errors';
import { kvGet, kvSet, withLock } from './store';
import {
  POLL_IDS,
  STAGES,
  type Election,
  type Nominee,
  type Poll,
  type PollId,
  type Stage,
} from './types';

const KEY = 'vote:election';

export const MAX_NOMINEES = 60;
export const MAX_TICKETS = 2000;
/** No 0/O, 1/I/L: a code typed off a printed pass should not be misread. */
const TICKET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TICKET_LENGTH = 8;

function newPoll(id: PollId): Poll {
  return {
    id,
    title: id === 'king' ? 'Best Dress — King' : 'Best Dress — Queen',
    status: 'draft',
    nominees: [],
    tally: {},
    ballots: {},
    openedAt: null,
    closedAt: null,
  };
}

function freshElection(): Election {
  return {
    title: 'Best Dress Awards',
    mode: 'device',
    stage: 'welcome',
    polls: { king: newPoll('king'), queen: newPoll('queen') },
    tickets: {},
    updatedAt: Date.now(),
  };
}

export function isPollId(value: unknown): value is PollId {
  return typeof value === 'string' && (POLL_IDS as readonly string[]).includes(value);
}

export function clean(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function shortId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('base64url')}`;
}

export function newTicketCode(): string {
  const bytes = randomBytes(TICKET_LENGTH);
  let code = '';
  for (const byte of bytes) code += TICKET_ALPHABET[byte % TICKET_ALPHABET.length];
  return code;
}

/** Normalises a typed or scanned code: case, spaces and dashes don't matter. */
export function normalizeTicket(value: unknown): string | null {
  const code = String(value ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  return code.length === TICKET_LENGTH && [...code].every((c) => TICKET_ALPHABET.includes(c))
    ? code
    : null;
}

/* ------------------------------------------------------------- storage */

/**
 * Phones poll the state every few seconds; a burst of hundreds of them should
 * cost one database read per second per server instance, not one each.
 */
const READ_CACHE_MS = 1000;
let cached: { at: number; election: Election } | null = null;

async function load(): Promise<Election> {
  return (await kvGet<Election>(KEY)) ?? freshElection();
}

export async function readElection(): Promise<Election> {
  if (cached && Date.now() - cached.at < READ_CACHE_MS) return structuredClone(cached.election);
  const election = await load();
  cached = { at: Date.now(), election };
  return structuredClone(election);
}

/** Every write goes through here: one at a time, across all server instances. */
export async function updateElection<T>(mutate: (election: Election) => T): Promise<{
  election: Election;
  result: T;
}> {
  return withLock(KEY, async () => {
    const election = await load();
    const result = mutate(election);
    election.updatedAt = Date.now();
    await kvSet(KEY, election);
    cached = { at: Date.now(), election: structuredClone(election) };
    return { election, result };
  });
}

/* --------------------------------------------------------------- rules */

export function findNominee(poll: Poll, nomineeId: unknown): Nominee {
  const nominee = poll.nominees.find((n) => n.id === nomineeId);
  if (!nominee) throw new HttpError(404, 'That nominee is not on the list');
  return nominee;
}

export function hasVotes(election: Election): boolean {
  return POLL_IDS.some((id) => Object.keys(election.polls[id].ballots).length > 0);
}

/**
 * Records one ballot. The voter key is what makes a person "one person": a
 * device id in device mode, a pass code in ticket mode.
 */
export function castVote(
  election: Election,
  pollId: PollId,
  nomineeId: unknown,
  voterKey: string,
  ticket: string | null,
): Nominee {
  const poll = election.polls[pollId];
  if (poll.status !== 'open') {
    throw new HttpError(
      409,
      poll.status === 'closed' ? 'Voting has closed' : 'Voting has not opened yet',
    );
  }
  const nominee = findNominee(poll, nomineeId);
  const previous = poll.ballots[voterKey];
  if (previous) {
    const chosen = poll.nominees.find((n) => n.id === previous.nomineeId);
    throw new HttpError(409, `You already voted${chosen ? ` for ${chosen.name}` : ''}`);
  }
  const now = Date.now();
  poll.ballots[voterKey] = { nomineeId: nominee.id, at: now };
  poll.tally[nominee.id] = (poll.tally[nominee.id] ?? 0) + 1;
  if (ticket) election.tickets[ticket].used[pollId] = now;
  return nominee;
}

/** Removing a nominee also voids the ballots cast for them, so those voters can vote again. */
export function removeNominee(election: Election, pollId: PollId, nomineeId: unknown): void {
  const poll = election.polls[pollId];
  const nominee = findNominee(poll, nomineeId);
  poll.nominees = poll.nominees.filter((n) => n.id !== nominee.id);
  delete poll.tally[nominee.id];
  for (const [voter, ballot] of Object.entries(poll.ballots)) {
    if (ballot.nomineeId !== nominee.id) continue;
    delete poll.ballots[voter];
    releaseTicket(election, voter, pollId);
  }
}

export function resetVotes(election: Election, pollId: PollId): void {
  const poll = election.polls[pollId];
  for (const voter of Object.keys(poll.ballots)) releaseTicket(election, voter, pollId);
  poll.ballots = {};
  poll.tally = {};
}

/** A poll's votes are deleted and it goes back to "not open yet". The list stays. */
export function resetPoll(election: Election, pollId: PollId): void {
  const poll = election.polls[pollId];
  resetVotes(election, pollId);
  poll.status = 'draft';
  poll.openedAt = null;
  poll.closedAt = null;
  rewindStage(election, pollId);
}

/** Empties a poll's nominee list (and with it every vote). */
export function clearNominees(election: Election, pollId: PollId): number {
  const removed = election.polls[pollId].nominees.length;
  resetPoll(election, pollId);
  election.polls[pollId].nominees = [];
  return removed;
}

/**
 * If the show is on (or past) a poll that was just reset, step back to just
 * before that poll, so the Live screen never shows a result that is gone.
 */
function rewindStage(election: Election, pollId: PollId): void {
  const stage = election.stage ?? 'welcome';
  const affected =
    stage === 'finale' || stage === `${pollId}-voting` || stage === `${pollId}-result`;
  if (!affected) return;
  election.stage =
    pollId === 'queen' && election.polls.king.status === 'closed' ? 'king-result' : 'welcome';
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

/**
 * Moves the show to a stage, opening or closing the vote it belongs to. Any
 * step can be revisited (to fix a mistake), but each needs what comes before it.
 */
export function goToStage(election: Election, stage: Stage): void {
  const { king, queen } = election.polls;
  const open = (poll: Poll) => {
    if (!poll.nominees.length) {
      throw new HttpError(400, `Add the nominees for ${poll.title} first`);
    }
    poll.status = 'open';
    poll.openedAt ??= Date.now();
    poll.closedAt = null;
  };
  const close = (poll: Poll) => {
    if (poll.status === 'draft') throw new HttpError(409, `${poll.title} has not been opened yet`);
    if (poll.status === 'open') {
      poll.status = 'closed';
      poll.closedAt = Date.now();
    }
  };
  switch (stage) {
    case 'welcome':
      break;
    case 'king-voting':
      open(king);
      break;
    case 'king-result':
      close(king);
      break;
    case 'queen-voting':
      open(queen);
      break;
    case 'queen-result':
      close(queen);
      break;
    case 'finale':
      if (king.status !== 'closed' || queen.status !== 'closed') {
        throw new HttpError(409, 'Close both King and Queen voting first');
      }
      break;
  }
  election.stage = stage;
}

function releaseTicket(election: Election, voterKey: string, pollId: PollId): void {
  if (!voterKey.startsWith('t:')) return;
  const ticket = election.tickets[voterKey.slice(2)];
  if (ticket) delete ticket.used[pollId];
}

/**
 * Adds nominees from pasted text, one per line. "Name | note" (or a tab)
 * splits off the optional second line. Duplicate names are skipped.
 */
export function addNominees(poll: Poll, text: string): number {
  const existing = new Set(poll.nominees.map((n) => n.name.toLowerCase()));
  let added = 0;
  for (const line of text.split(/\r?\n/)) {
    const [rawName, ...rest] = line.split(/\t|\|/);
    const name = clean(rawName, 40);
    if (!name || existing.has(name.toLowerCase())) continue;
    if (poll.nominees.length >= MAX_NOMINEES) {
      throw new HttpError(409, `A list holds at most ${MAX_NOMINEES} nominees`);
    }
    poll.nominees.push({ id: shortId('n'), name, note: clean(rest.join(' '), 60) });
    existing.add(name.toLowerCase());
    added += 1;
  }
  return added;
}
