import { kvGet, kvSet, withLock } from './store';
import { CATEGORY_COLORS, DEFAULT_TEAMS, MAX_DURATION, MIN_DURATION, TEAM_COLORS } from './ui';
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

const BANK_KEY = 'charade:bank';
const ROOM_TTL_SECONDS = 60 * 60 * 12;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export { CATEGORY_COLORS, DEFAULT_TEAMS, MAX_DURATION, MIN_DURATION, TEAM_COLORS } from './ui';

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
  { name: '动物', items: ['长颈鹿', '企鹅', '考拉', '螃蟹', '蝙蝠', '孔雀'] },
  { name: '电影', items: ['泰坦尼克号', '哈利波特', '功夫熊猫', '流浪地球', '狮子王'] },
  { name: '动作', items: ['刷牙', '游泳', '打篮球', '弹吉他', '拍照', '睡觉'] },
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

export function bankSize(bank: Bank, categoryIds: string[] = []): number {
  return pickCategories(bank, categoryIds).reduce((sum, c) => sum + c.items.length, 0);
}

function pickCategories(bank: Bank, categoryIds: string[]): Category[] {
  if (!categoryIds.length) return bank.categories;
  const wanted = new Set(categoryIds);
  return bank.categories.filter((c) => wanted.has(c.id));
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
    if (!room) throw new HttpError(404, '房间不存在或已过期');
    settle(room);
    await mutate(room);
    return saveRoom(room);
  });
}

export async function createRoom(hostName: string, team: string): Promise<Room> {
  const now = Date.now();
  const host: Player = {
    id: id('p'),
    name: clean(hostName, 20) || '房主',
    team: team || DEFAULT_TEAMS[0],
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
    settings: { durationSec: 60, categoryIds: [], skipPenalty: false },
    players: [host],
    teams: [...DEFAULT_TEAMS],
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

export function joinRoom(room: Room, name: string, team: string): Player {
  const cleanName = clean(name, 20) || '玩家';
  const taken = room.players.some((p) => p.name.toLowerCase() === cleanName.toLowerCase());
  const now = Date.now();
  const player: Player = {
    id: id('p'),
    name: taken ? `${cleanName}(${room.players.length + 1})` : cleanName,
    team: room.teams.includes(team) ? team : room.teams[0],
    isHost: room.players.length === 0,
    joinedAt: now,
    lastSeen: now,
  };
  if (player.isHost) room.hostId = player.id;
  room.players.push(player);
  if (room.state === 'playing') room.current[player.id] = drawCard(room);
  return player;
}

export function requirePlayer(room: Room, playerId: string): Player {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new HttpError(403, '你不在这个房间里，请重新加入');
  return player;
}

export function requireHost(room: Room, playerId: string): Player {
  const player = requirePlayer(room, playerId);
  if (player.id !== room.hostId) throw new HttpError(403, '只有房主可以执行这个操作');
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

export function applySettings(room: Room, patch: Partial<RoomSettings>): void {
  if (typeof patch.durationSec === 'number' && Number.isFinite(patch.durationSec)) {
    room.settings.durationSec = Math.min(
      MAX_DURATION,
      Math.max(MIN_DURATION, Math.round(patch.durationSec)),
    );
  }
  if (Array.isArray(patch.categoryIds)) {
    room.settings.categoryIds = patch.categoryIds.filter((v) => typeof v === 'string');
  }
  if (typeof patch.skipPenalty === 'boolean') room.settings.skipPenalty = patch.skipPenalty;
}

export function setTeams(room: Room, teams: string[]): void {
  const next = teams.map((t) => clean(t, 16)).filter(Boolean).slice(0, TEAM_COLORS.length);
  if (!next.length) throw new HttpError(400, '至少需要一个组别');
  room.teams = Array.from(new Set(next));
  for (const player of room.players) {
    if (!room.teams.includes(player.team)) player.team = room.teams[0];
  }
}

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
  if (!deck.length) throw new HttpError(400, '题库是空的，请先添加题目或选择别的分类');
  if (!room.players.length) throw new HttpError(400, '房间里还没有玩家');
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
  for (const player of room.players) room.current[player.id] = drawCard(room);
}

export function answer(room: Room, playerId: string, result: AnswerResult): void {
  settle(room);
  if (room.state !== 'playing') throw new HttpError(409, '本轮还没开始或已经结束');
  const player = requirePlayer(room, playerId);
  const card = room.current[player.id];
  if (!card) throw new HttpError(409, '没有可以作答的题目');
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
    const row = table.get(player.team);
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

/* ---------------------------------------------------------------- errors */

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
