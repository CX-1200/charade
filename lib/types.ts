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
  /** Round length in seconds, chosen by the host. */
  durationSec: number;
  /** Empty array means "every category". */
  categoryIds: string[];
  /** When true a skip costs the team one point. */
  skipPenalty: boolean;
};

export type Round = {
  index: number;
  startedAt: number;
  endedAt: number;
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
