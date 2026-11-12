export const POLL_IDS = ['king', 'queen'] as const;
export type PollId = (typeof POLL_IDS)[number];

/** draft: being set up · open: taking votes · closed: final (can be reopened). */
export type PollStatus = 'draft' | 'open' | 'closed';

export type Nominee = {
  id: string;
  name: string;
  /** Optional second line, e.g. "Table 4 · Finance". */
  note: string;
};

export type Ballot = { nomineeId: string; at: number };

export type Poll = {
  id: PollId;
  title: string;
  status: PollStatus;
  nominees: Nominee[];
  /** nomineeId -> votes. Kept alongside the ballots so reads never recount. */
  tally: Record<string, number>;
  /** voterKey -> the one ballot that voter cast in this poll. */
  ballots: Record<string, Ballot>;
  openedAt: number | null;
  closedAt: number | null;
};

/**
 * device: one vote per phone/browser (a random id kept in a cookie + storage).
 * ticket: one vote per personal voting pass (a printed one-time code).
 */
export type VoteMode = 'device' | 'ticket';

export type Ticket = {
  code: string;
  createdAt: number;
  /** When this pass voted in each poll. */
  used: Partial<Record<PollId, number>>;
};

/**
 * The show, in its fixed order. The admin steps through it in Manage and the
 * Live screen follows: King votes, King's result, Queen votes, Queen's
 * result, then the Best Dress finale with both winners.
 */
export const STAGES = [
  'welcome',
  'king-voting',
  'king-result',
  'queen-voting',
  'queen-result',
  'finale',
] as const;
export type Stage = (typeof STAGES)[number];

export type Election = {
  title: string;
  /** Older stored elections have no value here; read it as 'welcome'. */
  stage?: Stage;
  mode: VoteMode;
  polls: Record<PollId, Poll>;
  tickets: Record<string, Ticket>;
  updatedAt: number;
};
