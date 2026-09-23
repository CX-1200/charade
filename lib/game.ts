import { kvGet, kvSet, withLock } from './store';
import { HttpError } from './errors';
import { CATEGORY_COLORS, MAX_DURATION, MIN_DURATION, TEAM_COLORS } from './ui';
import type {
  AnswerResult,
  Bank,
  Category,
  DeckEntry,
  Player,
  Room,
  RoomSettings,
  TeamScore,
} from './types';

export { HttpError };
export { CATEGORY_COLORS, MAX_DURATION, MIN_DURATION, TEAM_COLORS } from './ui';

const BANK_KEY = 'charade:bank';
/**
 * Rooms have no lifetime of their own: they survive an empty lobby and are
 * reusable the next day. This TTL is storage hygiene only — it is refreshed on
 * every write, so a room disappears solely after a month of total silence.
 */
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 30;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_TEAMS = TEAM_COLORS.length;

export function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function roomCode(): string {
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

export function shuffle<T>(input: T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function clean(value: unknown, max = 120): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* ------------------------------------------------------------------ bank */

const SEED: Array<{ name: string; items: string[] }> = [
  { name: 'Animals', items: ['Giraffe', 'Penguin', 'Koala', 'Crab', 'Bat', 'Peacock'] },
  {
    name: 'Movies',
    items: ['Titanic', 'Harry Potter', 'Kung Fu Panda', 'Jurassic Park', 'The Lion King'],
  },
  {
    name: 'Actions',
    items: [
      'Brushing teeth',
      'Swimming',
      'Playing basketball',
      'Playing guitar',
      'Taking a photo',
      'Sleeping',
    ],
  },
];

function seedBank(): Bank {
  const now = Date.now();
  return {
    categories: SEED.map((entry, index) => ({
      id: id('cat'),
      name: entry.name,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      createdAt: now + index,
      items: entry.items.map((text, i) => ({ id: id('q'), text, createdAt: now + i })),
    })),
    updatedAt: now,
  };
}

export async function getBank(): Promise<Bank> {
  const stored = await kvGet<Bank>(BANK_KEY);
  if (stored?.categories) return stored;
  const fresh = seedBank();
  await kvSet(BANK_KEY, fresh);
  return fresh;
}

export async function updateBank(mutate: (bank: Bank) => void): Promise<Bank> {
  return withLock(BANK_KEY, async () => {
    const bank = await getBank();
    mutate(bank);
    bank.updatedAt = Date.now();
    await kvSet(BANK_KEY, bank);
    return bank;
  });
}

export type BankExport = {
  format: 'charade-question-bank';
  version: 1;
  exportedAt: string;
  categories: Array<{ name: string; color?: string; items: string[] }>;
};

export function exportBank(bank: Bank): BankExport {
  return {
    format: 'charade-question-bank',
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: bank.categories.map((c) => ({
      name: c.name,
      color: c.color,
      items: c.items.map((i) => i.text),
    })),
  };
}

/**
 * Loads an exported bank back in. Liberal about shape (ids are regenerated, a
 * category may carry plain strings or `{text}` items) and strict about the
 * result: names and questions are cleaned and de-duplicated either way.
 *
 * `merge` keeps what is already there and tops it up; `replace` swaps the whole
 * bank for the file.
 */
export function importBank(bank: Bank, payload: unknown, mode: 'merge' | 'replace'): number {
  const source = payload as { categories?: unknown };
  if (!source || !Array.isArray(source.categories)) {
    throw new HttpError(400, 'That file is not a question bank export');
  }

  if (mode === 'replace') bank.categories = [];
  let added = 0;

  for (const raw of source.categories) {
    const entry = raw as { name?: unknown; color?: unknown; items?: unknown };
    const name = clean(entry.name, 30);
    if (!name) continue;

    let category = bank.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!category) {
      category = {
        id: id('cat'),
        name,
        color:
          typeof entry.color === 'string' && /^#[0-9a-f]{6}$/i.test(entry.color)
            ? entry.color
            : CATEGORY_COLORS[bank.categories.length % CATEGORY_COLORS.length],
        items: [],
        createdAt: Date.now(),
      };
      bank.categories.push(category);
    }

    const existing = new Set(category.items.map((i) => i.text.toLowerCase()));
    for (const item of Array.isArray(entry.items) ? entry.items : []) {
      const text = clean(typeof item === 'string' ? item : (item as { text?: unknown })?.text, 60);
      if (!text || existing.has(text.toLowerCase())) continue;
      existing.add(text.toLowerCase());
      category.items.push({ id: id('q'), text, createdAt: Date.now() });
      added += 1;
    }
  }

  if (!bank.categories.length) throw new HttpError(400, 'That file has no usable categories');
  return added;
}

/** Strictly the categories named in `categoryIds` — an empty list means none. */
function pickCategories(bank: Bank, categoryIds: string[]): Category[] {
  const wanted = new Set(categoryIds);
  return bank.categories.filter((c) => wanted.has(c.id));
}

export function countPrompts(bank: Bank, categoryIds: string[]): number {
  return pickCategories(bank, categoryIds).reduce((sum, c) => sum + c.items.length, 0);
}

/** Every selected category is melted into one shuffled deck — that is the "mix". */
export function buildDeck(bank: Bank, categoryIds: string[]): DeckEntry[] {
  const entries: DeckEntry[] = [];
  for (const category of pickCategories(bank, categoryIds)) {
    for (const item of category.items) {
      entries.push({
        itemId: item.id,
        text: item.text,
        categoryId: category.id,
        categoryName: category.name,
        color: category.color,
      });
    }
  }
  return shuffle(entries);
}

/* ------------------------------------------------------------------ room */

const roomKey = (code: string) => `charade:room:${code.toUpperCase()}`;

export async function getRoom(code: string): Promise<Room | null> {
  if (!code) return null;
  return kvGet<Room>(roomKey(code));
}

export async function saveRoom(room: Room): Promise<Room> {
  room.updatedAt = Date.now();
  await kvSet(roomKey(room.code), room, ROOM_TTL_SECONDS);
  return room;
}

export async function withRoom(
  code: string,
  mutate: (room: Room) => void | Promise<void>,
): Promise<Room> {
  return withLock(roomKey(code), async () => {
    const room = await getRoom(code);
    if (!room) throw new HttpError(404, 'Room not found');
    settle(room);
    await mutate(room);
    // An empty room stays put — the same code works when people come back.
    return saveRoom(room);
  });
}

export async function createRoom(hostName: string): Promise<Room> {
  const now = Date.now();
  const bank = await getBank();
  const host: Player = {
    id: id('p'),
    name: clean(hostName, 20) || 'Host',
    team: '',
    isHost: true,
    joinedAt: now,
    lastSeen: now,
  };
  let code = roomCode();
  for (let attempt = 0; attempt < 8 && (await getRoom(code)); attempt += 1) code = roomCode();

  const room: Room = {
    code,
    hostId: host.id,
    state: 'lobby',
    settings: {
      durationSec: 60,
      // Start with every category that exists right now; the admin can trim it.
      categoryIds: bank.categories.map((c) => c.id),
      activeTeams: [],
      skipPenalty: false,
    },
    players: [host],
    teams: [],
    deck: [],
    cursor: 0,
    current: {},
    log: [],
    history: [],
    startedAt: null,
    endsAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return saveRoom(room);
}

export function joinRoom(room: Room, name: string): Player {
  const cleanName = clean(name, 20) || 'Player';
  const taken = room.players.some((p) => p.name.toLowerCase() === cleanName.toLowerCase());
  const now = Date.now();
  const player: Player = {
    id: id('p'),
    name: taken ? `${cleanName} (${room.players.length + 1})` : cleanName,
    // No team yet — the room asks the player to join or create one.
    team: '',
    isHost: room.players.length === 0,
    joinedAt: now,
    lastSeen: now,
  };
  if (player.isHost) room.hostId = player.id;
  room.players.push(player);
  return player;
}

export function requirePlayer(room: Room, playerId: string): Player {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new HttpError(403, 'You are not in this room — please join again');
  return player;
}

export function touch(room: Room, playerId?: string | null): void {
  if (!playerId) return;
  const player = room.players.find((p) => p.id === playerId);
  if (player) player.lastSeen = Date.now();
}

export function removePlayer(room: Room, playerId: string): void {
  room.players = room.players.filter((p) => p.id !== playerId);
  delete room.current[playerId];
  if (room.hostId === playerId && room.players.length) {
    room.players[0].isHost = true;
    room.hostId = room.players[0].id;
  }
}

export function renamePlayer(room: Room, playerId: string, name: string): void {
  const player = requirePlayer(room, playerId);
  const next = clean(name, 20);
  if (!next) throw new HttpError(400, 'Please enter a name');
  const taken = room.players.some(
    (p) => p.id !== playerId && p.name.toLowerCase() === next.toLowerCase(),
  );
  if (taken) throw new HttpError(409, 'Somebody in this room already uses that name');
  player.name = next;
}

/* ----------------------------------------------------------------- teams */

export function createTeam(room: Room, playerId: string, name: string): string {
  const team = clean(name, 16);
  if (!team) throw new HttpError(400, 'Please enter a team name');
  if (room.teams.some((t) => t.toLowerCase() === team.toLowerCase())) {
    throw new HttpError(409, 'That team already exists — join it instead');
  }
  if (room.teams.length >= MAX_TEAMS) {
    throw new HttpError(409, `A room holds at most ${MAX_TEAMS} teams`);
  }
  room.teams.push(team);
  // A brand new team takes part in the round by default.
  room.settings.activeTeams.push(team);
  if (playerId) joinTeam(room, playerId, team);
  return team;
}

export function joinTeam(room: Room, playerId: string, team: string): void {
  const player = requirePlayer(room, playerId);
  if (!room.teams.includes(team)) throw new HttpError(400, 'That team does not exist');
  player.team = team;
}

export function removeTeam(room: Room, team: string): void {
  if (!room.teams.includes(team)) throw new HttpError(404, 'That team does not exist');
  room.teams = room.teams.filter((t) => t !== team);
  room.settings.activeTeams = room.settings.activeTeams.filter((t) => t !== team);
  for (const player of room.players) {
    if (player.team === team) player.team = '';
  }
}

export function setTeamActive(room: Room, team: string, active: boolean): void {
  if (!room.teams.includes(team)) throw new HttpError(404, 'That team does not exist');
  const current = new Set(room.settings.activeTeams);
  if (active) current.add(team);
  else current.delete(team);
  room.settings.activeTeams = room.teams.filter((t) => current.has(t));
}

export function isTeamActive(room: Room, team: string): boolean {
  return !!team && room.settings.activeTeams.includes(team);
}

/* -------------------------------------------------------------- settings */

export function applySettings(room: Room, patch: Partial<RoomSettings>): void {
  if (typeof patch.durationSec === 'number' && Number.isFinite(patch.durationSec)) {
    room.settings.durationSec = Math.min(
      MAX_DURATION,
      Math.max(MIN_DURATION, Math.round(patch.durationSec)),
    );
  }
  if (Array.isArray(patch.categoryIds)) {
    room.settings.categoryIds = [
      ...new Set(patch.categoryIds.filter((v) => typeof v === 'string')),
    ];
  }
  if (typeof patch.skipPenalty === 'boolean') room.settings.skipPenalty = patch.skipPenalty;
}

/* ----------------------------------------------------------------- round */

function drawCard(room: Room): DeckEntry | null {
  if (!room.deck.length) return null;
  if (room.cursor >= room.deck.length) {
    // Everyone burned through the whole bank — reshuffle and keep playing.
    room.deck = shuffle(room.deck);
    room.cursor = 0;
  }
  const card = room.deck[room.cursor];
  room.cursor += 1;
  return card ?? null;
}

export function startRound(room: Room, deck: DeckEntry[]): void {
  if (!deck.length) {
    throw new HttpError(400, 'No questions available — add some or select more categories');
  }
  if (!room.settings.activeTeams.length) {
    throw new HttpError(400, 'Select at least one team to play this round');
  }
  const playing = room.players.filter((p) => isTeamActive(room, p.team));
  if (!playing.length) throw new HttpError(400, 'No players are on a participating team');
  // Starting while a round is live must not silently drop that round's scores.
  if (room.state === 'playing') finishRound(room);

  const now = Date.now();
  room.deck = deck;
  room.cursor = 0;
  room.current = {};
  room.log = [];
  room.state = 'playing';
  room.startedAt = now;
  room.endsAt = now + room.settings.durationSec * 1000;
  for (const player of playing) room.current[player.id] = drawCard(room);
}

export function answer(room: Room, playerId: string, result: AnswerResult): void {
  settle(room);
  if (room.state !== 'playing') throw new HttpError(409, 'The round is not running');
  const player = requirePlayer(room, playerId);
  if (!isTeamActive(room, player.team)) {
    throw new HttpError(403, 'Your team is sitting this round out');
  }
  const card = room.current[player.id];
  if (!card) throw new HttpError(409, 'No card to answer');
  room.log.push({
    playerId: player.id,
    playerName: player.name,
    team: player.team,
    text: card.text,
    categoryName: card.categoryName,
    result,
    at: Date.now(),
  });
  room.current[player.id] = drawCard(room);
  player.lastSeen = Date.now();
}

/** Ends the round if the clock has run out. Safe to call on every read. */
export function settle(room: Room): boolean {
  if (room.state !== 'playing' || !room.endsAt || Date.now() < room.endsAt) return false;
  finishRound(room);
  return true;
}

export function finishRound(room: Room): void {
  if (room.state !== 'playing') return;
  room.history.push({
    index: room.history.length + 1,
    startedAt: room.startedAt ?? Date.now(),
    endedAt: Date.now(),
    log: [...room.log],
  });
  room.state = 'finished';
  room.current = {};
  room.endsAt = room.endsAt ?? Date.now();
}

export function resetRoom(room: Room): void {
  room.state = 'lobby';
  room.deck = [];
  room.cursor = 0;
  room.current = {};
  room.log = [];
  room.startedAt = null;
  room.endsAt = null;
}

export function clearHistory(room: Room): void {
  room.history = [];
}

/* --------------------------------------------------------------- scoring */

export function scoreLog(
  room: Room,
  log: Array<{ team: string; result: AnswerResult; playerName: string }>,
): TeamScore[] {
  const table = new Map<string, TeamScore>();
  for (const team of room.teams) {
    table.set(team, { team, correct: 0, skipped: 0, score: 0, players: [] });
  }
  for (const player of room.players) {
    const row = player.team ? table.get(player.team) : undefined;
    if (row && !row.players.includes(player.name)) row.players.push(player.name);
  }
  for (const entry of log) {
    let row = table.get(entry.team);
    if (!row) {
      row = { team: entry.team, correct: 0, skipped: 0, score: 0, players: [] };
      table.set(entry.team, row);
    }
    if (entry.result === 'correct') {
      row.correct += 1;
      row.score += 1;
    } else {
      row.skipped += 1;
      if (room.settings.skipPenalty) row.score -= 1;
    }
  }
  return [...table.values()].sort((a, b) => b.score - a.score || b.correct - a.correct);
}

export function roundScores(room: Room): TeamScore[] {
  return scoreLog(room, room.log);
}

export function totalScores(room: Room): TeamScore[] {
  const all = [...room.history.flatMap((r) => r.log), ...(room.state === 'playing' ? room.log : [])];
  return scoreLog(room, all);
}
