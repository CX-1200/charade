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
  id: string;
  name: string;
  /** Empty until the player picks or creates a team. */
  team: string;
  isHost: boolean;
  joinedAt: number;
  lastSeen: number;
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
  text: string;
  categoryName: string;
  result: AnswerResult;
  at: number;
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

/** Per-team totals. Kept incrementally so scoring never depends on the log. */
export type Tally = Record<string, { correct: number; skipped: number }>;

export type Round = {
  index: number;
  startedAt: number;
  endedAt: number;
  tally: Tally;
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
  deck: DeckEntry[];
  cursor: number;
  /** Authoritative score source for the round in progress. */
  tally: Tally;
  /** playerId -> the card that player is currently holding (null = deck exhausted). */
  current: Record<string, DeckEntry | null>;
  log: LogEntry[];
  history: Round[];
  startedAt: number | null;
  endsAt: number | null;
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
