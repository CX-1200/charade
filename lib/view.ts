import { POLL_IDS, type Election, type PollId } from './types';

/**
 * What any screen may see: titles, nominees and live counts. Never the
 * ballots (who voted for whom) and never the pass codes.
 */
export function publicView(election: Election, voterKey: string | null) {
  return {
    now: Date.now(),
    title: election.title,
    mode: election.mode,
    display: election.display ?? 'auto',
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

/** The admin's view adds the voting passes. */
export function adminView(election: Election) {
  const tickets = Object.values(election.tickets).sort((a, b) => a.createdAt - b.createdAt);
  return {
    ...publicView(election, null),
    tickets: tickets.map((t) => ({ code: t.code, used: t.used })),
  };
}

export type PublicView = ReturnType<typeof publicView>;
export type AdminView = ReturnType<typeof adminView>;
