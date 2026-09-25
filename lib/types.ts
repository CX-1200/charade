export type QuestionItem = {
  id: string;
  text: string;
  createdAt: number;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  items: QuestionItem[];
  createdAt: number;
};

export type Bank = {
  categories: Category[];
  updatedAt: number;
};

export type RoomState = 'lobby' | 'playing' | 'finished';

export type Player = {
  /** Public identifier: shown to everyone, used for display and for kicking. Never a credential. */
  id: string;
  name: string;
  /** Empty until the player picks or creates a team. */
  team: string;
  isHost: boolean;
  joinedAt: number;
  lastSeen: number;
  /**
   * SHA-256 of the private secret handed to this player alone when they joined.
   * Every action taken as this player must present the secret. Missing on
   * players created before credentials existed — those are reclaimed by
   * rejoining under the same name.
   */
  secretHash?: string;
};

export type DeckEntry = {
  itemId: string;
  text: string;
  categoryId: string;
  categoryName: string;
  color: string;
};

export type AnswerResult = 'correct' | 'skip';

export type LogEntry = {
  playerId: string;
  playerName: string;
  team: string;
  /** The question itself. Never sent to screens while the round is live. */
  text: string;
  categoryName: string;
  result: AnswerResult;
  at: number;
  /** The team's run of consecutive correct answers after this one (0 after a skip). */
  streak: number;
  /** Set on the answer that completed the team's whole deck. */
  finished?: boolean;
};

export type RoomSettings = {
  /** Round length in seconds, chosen by the admin. */
  durationSec: number;
  /** Categories included in the round — an explicit list, never implicit "all". */
  categoryIds: string[];
  /** Teams taking part in the round; others sit it out. */
  activeTeams: string[];
  /** When true a skip costs the team one point. */
  skipPenalty: boolean;
};

/** Per-team (or per-player) totals. Kept incrementally so scoring never depends on the log. */
export type Tally = Record<string, { correct: number; skipped: number }>;

/**
 * Each team races through its own shuffled copy of the round's questions. A
 * skipped card goes back to the bottom, so a team only finishes by answering
 * every question correctly.
 */
export type TeamDeck = {
  /**
   * Positions in `roundDeck`, in the order this team will see them. Indexes
   * rather than copies: the room document is rewritten on every answer, and
   * ten teams each carrying every question would multiply its size.
   */
  queue: number[];
  /** Questions in the round — the same number for every team. */
  total: number;
  /** Answered correctly so far. */
  done: number;
  finishedAt: number | null;
  streak: number;
  bestStreak: number;
};

/** How one team fared in a round: the basis of placings and "time taken". */
export type TeamResult = {
  team: string;
  done: number;
  total: number;
  finishedAt: number | null;
  bestStreak: number;
};

export type Round = {
  index: number;
  startedAt: number;
  endedAt: number;
  tally: Tally;
  teams: TeamResult[];
  /** Display only — trimmed to the most recent answers. */
  log: LogEntry[];
};

export type Room = {
  code: string;
  hostId: string;
  state: RoomState;
  settings: RoomSettings;
  players: Player[];
  teams: string[];
  /** The round's questions, shuffled once; every team's deck is a copy of these. */
  roundDeck: DeckEntry[];
  /** team -> that team's own deck for the round in progress. */
  decks: Record<string, TeamDeck>;
  /** Teams in the order they completed their deck. */
  finishOrder: string[];
  /** Authoritative score source for the round in progress. */
  tally: Tally;
  /** playerId -> that player's own answers this round. */
  playerTally: Tally;
  /** playerId -> the card that player is currently holding (null = deck exhausted). */
  current: Record<string, DeckEntry | null>;
  log: LogEntry[];
  history: Round[];
  startedAt: number | null;
  endsAt: number | null;
  /** When the round actually stopped: the clock, the admin, or every team finishing. */
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type TeamScore = {
  team: string;
  correct: number;
  skipped: number;
  score: number;
  players: string[];
};
