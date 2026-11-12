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
  /** While voting runs: when the countdown ends and the votes lock. */
  endsAt?: number | null;
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
 * The show, in its fixed order. The admin steps through it in Manage and every
 * screen follows — guests' phones and the Live screen alike:
 *
 *   welcome → King: list shown → King: countdown, voting → King: result →
 *   Queen: the same three → finale (both winners).
 *
 * A voting stage turns into its result by itself when the countdown ends.
 */
export const STAGES = [
  'welcome',
  'king-open',
  'king-voting',
  'king-result',
  'queen-open',
  'queen-voting',
  'queen-result',
  'finale',
] as const;
export type Stage = (typeof STAGES)[number];

export type Election = {
  title: string;
  /** Older stored elections have no value here; read it as 'welcome'. */
  stage?: Stage;
  /**
   * The site is only "on" while the admin has a session open. Guests join by
   * scanning its QR code (which carries the id); anyone without it — early
   * arrivals included — sees a holding page and can do nothing.
   */
  session?: { id: string; openedAt: number } | null;
  mode: VoteMode;
  polls: Record<PollId, Poll>;
  tickets: Record<string, Ticket>;
  updatedAt: number;
};
