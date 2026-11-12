import { POLL_IDS, type Election, type PollId } from './types';

/**
 * What a guest in the session may see: titles, nominees and live counts.
 * Never the ballots (who voted for whom), the pass codes or the session id.
 */
export function publicView(election: Election, voterKey: string | null) {
  return {
    now: Date.now(),
    invited: true as const,
    title: election.title,
    mode: election.mode,
    stage: election.stage ?? 'welcome',
    polls: POLL_IDS.map((id) => {
      const poll = election.polls[id];
      return {
        id,
        title: poll.title,
        status: poll.status,
        nominees: poll.nominees,
        tally: poll.tally,
        total: Object.keys(poll.ballots).length,
        openedAt: poll.openedAt,
        closedAt: poll.closedAt,
        endsAt: poll.endsAt ?? null,
      };
    }),
    /** This voter's own choices, so their phone can show "You voted for …". */
    myVotes: Object.fromEntries(
      POLL_IDS.map((id) => [
        id,
        voterKey ? (election.polls[id].ballots[voterKey]?.nomineeId ?? null) : null,
      ]),
    ) as Record<PollId, string | null>,
  };
}

/**
 * Everyone outside the session — before the admin opens one, or without its
 * QR code — gets only this: the event's name and nothing to act on.
 */
export function guestView(election: Election) {
  return { now: Date.now(), invited: false as const, title: election.title };
}

/** The admin's view adds the session (for its QR code) and the voting passes. */
export function adminView(election: Election) {
  const tickets = Object.values(election.tickets).sort((a, b) => a.createdAt - b.createdAt);
  return {
    ...publicView(election, null),
    session: election.session ?? null,
    tickets: tickets.map((t) => ({ code: t.code, used: t.used })),
  };
}

export type PublicView = ReturnType<typeof publicView>;
export type GuestView = ReturnType<typeof guestView>;
export type AdminView = ReturnType<typeof adminView>;
