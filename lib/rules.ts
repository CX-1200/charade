import { HttpError } from './errors';
import { CATEGORY_COLORS, MAX_DURATION, MIN_DURATION, TEAM_COLORS } from './ui';
import type {
  AnswerResult,
  Tally,
  TeamDeck,
  TeamResult,
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

/**
 * A round with 50 players generates thousands of answers. The room document is
 * read and written on every request, so the log is display-only and capped;
 * scores come from `tally`, which is exact however many answers there are.
 */
export const MAX_LOG_ENTRIES = 200;

/**
 * A round starts this long after the admin presses Start. Screens learn about
 * the start by polling, and the lobby polls every few seconds, so without a
 * lead-in whoever polled last would lose seconds of their round. The lead-in
 * is longer than the slowest lobby poll, so everyone sees "3, 2, 1" and starts
 * answering at the same instant.
 */
export const LEAD_IN_MS = 4000;

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
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/* ------------------------------------------------------------------ bank */

const SEED: Array<{ name: string; items: string[] }> = [
  {
    name: 'Animals',
    items: ['Giraffe', 'Penguin', 'Koala', 'Crab', 'Bat', 'Peacock'],
  },
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

export function seedBank(): Bank {
  const now = Date.now();
  return {
    categories: SEED.map((entry, index) => ({
      id: id('cat'),
      name: entry.name,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      createdAt: now + index,
      items: entry.items.map((text, i) => ({
        id: id('q'),
        text,
        createdAt: now + i,
      })),
    })),
    updatedAt: now,
  };
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

/**
 * Rooms saved before a field existed come back without it. Filling the gaps on
 * read means the rest of the rules never have to ask.
 */
export function normalizeRoom(room: Room): Room {
  room.roundDeck ??= [];
  room.decks ??= {};
  room.finishOrder ??= [];
  room.playerTally ??= {};
  room.endedAt ??= null;
  for (const round of room.history) round.teams ??= [];
  return room;
}

/** Builds a fresh room in memory. Callers persist it and guarantee the code. */
export function makeRoom(
  code: string,
  hostName: string,
  categoryIds: string[],
  hostSecretHash: string,
): Room {
  const now = Date.now();
  const host: Player = {
    id: id('p'),
    name: clean(hostName, 20) || 'Host',
    team: '',
    isHost: true,
    joinedAt: now,
    lastSeen: now,
    secretHash: hostSecretHash,
  };
  return {
    code,
    hostId: host.id,
    state: 'lobby',
    settings: {
      durationSec: 60,
      // Start with every category that exists right now; the admin can trim it.
      categoryIds: [...categoryIds],
      activeTeams: [],
      skipPenalty: false,
    },
    players: [host],
    teams: [],
    roundDeck: [],
    decks: {},
    finishOrder: [],
    tally: {},
    playerTally: {},
    current: {},
    log: [],
    history: [],
    startedAt: null,
    endsAt: null,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A player saved before credentials existed, with this name. Their public id
 * was the only thing needed to act as them, so anyone could already; letting
 * the first person to rejoin under that name take the record over — and secure
 * it — loses nothing and spares everyone a duplicate "Name (2)".
 */
export function findUnclaimedPlayer(room: Room, name: string): Player | null {
  const wanted = clean(name, 20).toLowerCase();
  return room.players.find((p) => !p.secretHash && p.name.toLowerCase() === wanted) ?? null;
}

export function joinRoom(room: Room, name: string, secretHash: string): Player {
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
    secretHash,
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
  // A card in the hand of someone leaving goes back to their team, not missing.
  returnCard(room, playerId);
  room.players = room.players.filter((p) => p.id !== playerId);
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

function bump(tally: Tally, key: string, result: AnswerResult): void {
  const row = (tally[key] ??= { correct: 0, skipped: 0 });
  if (result === 'correct') row.correct += 1;
  else row.skipped += 1;
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
  if (player.team === team) return;
  // Mid-round, the card stays with the team it was dealt from…
  returnCard(room, player.id);
  player.team = team;
  // …and the player picks up a card from their new team.
  if (room.state === 'playing' && isTeamActive(room, team)) dealTo(room, player);
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
  // Switched on mid-round: the team joins the race with the same questions.
  if (active && room.state === 'playing') {
    for (const p of room.players) if (p.team === team && !room.current[p.id]) dealTo(room, p);
  }
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

/* ---------------------------------------------------------------- decks */

function draw(room: Room, deck: TeamDeck): DeckEntry | null {
  const index = deck.queue.shift();
  return index === undefined ? null : (room.roundDeck[index] ?? null);
}

/** A card goes back to the bottom of the deck. */
function putBack(room: Room, deck: TeamDeck, card: DeckEntry): void {
  const index = room.roundDeck.findIndex((e) => e.itemId === card.itemId);
  if (index !== -1) deck.queue.push(index);
}

function newTeamDeck(room: Room): TeamDeck {
  return {
    queue: shuffle(room.roundDeck.map((_, index) => index)),
    total: room.roundDeck.length,
    done: 0,
    finishedAt: null,
    streak: 0,
    bestStreak: 0,
  };
}

/**
 * A team joining the race late — created mid-round, or an active team whose
 * first player arrives after the start — gets the same questions as everyone.
 */
function ensureDeck(room: Room, team: string): TeamDeck | null {
  if (room.state !== 'playing' || !isTeamActive(room, team)) return null;
  return (room.decks[team] ??= newTeamDeck(room));
}

function dealTo(room: Room, player: Player): void {
  const deck = ensureDeck(room, player.team);
  room.current[player.id] = deck ? draw(room, deck) : null;
}

/** Puts a player's card back at the bottom of the deck it came from. */
function returnCard(room: Room, playerId: string): void {
  const card = room.current[playerId];
  delete room.current[playerId];
  const team = room.players.find((p) => p.id === playerId)?.team;
  if (card && team && room.decks[team]) {
    putBack(room, room.decks[team], card);
    refill(room, team, playerId);
  }
}

/**
 * Teammates can be left empty-handed while the rest of the team holds the last
 * cards. When a card comes back to the deck, hand it to whoever is waiting.
 */
function refill(room: Room, team: string, except?: string): void {
  const deck = room.decks[team];
  if (!deck || deck.finishedAt) return;
  for (const p of room.players) {
    if (!deck.queue.length) return;
    if (p.team === team && p.id !== except && !room.current[p.id]) {
      room.current[p.id] = draw(room, deck);
    }
  }
}

/* ----------------------------------------------------------------- round */

export function startRound(room: Room, deck: DeckEntry[]): void {
  if (!deck.length) {
    throw new HttpError(400, 'No questions available — add some or select more categories');
  }
  if (!room.teams.length) {
    throw new HttpError(400, 'No teams yet — a player needs to create one before you can start');
  }
  if (!room.settings.activeTeams.length) {
    throw new HttpError(400, 'Select at least one team to play this round');
  }
  const playing = room.players.filter((p) => isTeamActive(room, p.team));
  if (!playing.length) throw new HttpError(400, 'No players are on a participating team');
  // Starting while a round is live must not silently drop that round's scores.
  if (room.state === 'playing') finishRound(room);

  const startsAt = Date.now() + LEAD_IN_MS;
  room.roundDeck = deck;
  room.decks = {};
  room.finishOrder = [];
  room.current = {};
  room.log = [];
  room.tally = {};
  room.playerTally = {};
  room.state = 'playing';
  room.startedAt = startsAt;
  room.endsAt = startsAt + room.settings.durationSec * 1000;
  room.endedAt = null;
  // Every team with players races through its own shuffle of the same questions.
  for (const player of playing) dealTo(room, player);
}

export function answer(room: Room, playerId: string, result: AnswerResult): void {
  settle(room);
  if (room.state !== 'playing') throw new HttpError(409, 'The round is not running');
  if (room.startedAt && Date.now() < room.startedAt) {
    throw new HttpError(409, 'The round has not started yet');
  }
  const player = requirePlayer(room, playerId);
  if (!player.team) throw new HttpError(403, 'You are watching this round, not playing');
  if (!isTeamActive(room, player.team)) {
    throw new HttpError(403, 'Your team is sitting this round out');
  }
  const deck = room.decks[player.team];
  if (!deck) throw new HttpError(409, 'This round started before an update — start a new round');
  if (deck.finishedAt) throw new HttpError(409, 'Your team has already finished every question');
  const card = room.current[player.id];
  if (!card) throw new HttpError(409, 'No card to answer');

  const now = Date.now();
  bump(room.tally, player.team, result);
  bump(room.playerTally, player.id, result);

  if (result === 'correct') {
    deck.done += 1;
    deck.streak += 1;
    deck.bestStreak = Math.max(deck.bestStreak, deck.streak);
  } else {
    // A skipped card is not gone: it waits at the bottom of the team's deck.
    deck.streak = 0;
    putBack(room, deck, card);
  }

  const finished = deck.done >= deck.total;
  if (finished) {
    deck.finishedAt = now;
    room.finishOrder.push(player.team);
  }

  room.log.push({
    playerId: player.id,
    playerName: player.name,
    team: player.team,
    text: card.text,
    categoryName: card.categoryName,
    result,
    at: now,
    streak: deck.streak,
    ...(finished ? { finished: true } : {}),
  });
  // Bound the document: the log is a feed, the tally is the score.
  if (room.log.length > MAX_LOG_ENTRIES) room.log = room.log.slice(-MAX_LOG_ENTRIES);

  room.current[player.id] = draw(room, deck);
  if (finished) {
    for (const p of room.players) if (p.team === player.team) room.current[p.id] = null;
  } else {
    refill(room, player.team);
  }
  player.lastSeen = now;

  // The first team home is the winner, but everyone else keeps playing. Only
  // once every racing team is done is there nothing left to play for.
  const racing = Object.entries(room.decks)
    .filter(([team]) => isTeamActive(room, team))
    .map(([, d]) => d);
  if (finished && racing.length && racing.every((d) => d.finishedAt)) finishRound(room, now);
}

/** Ends the round if the clock has run out. Safe to call on every read. */
export function settle(room: Room): boolean {
  if (room.state !== 'playing' || !room.endsAt || Date.now() < room.endsAt) return false;
  finishRound(room, room.endsAt);
  return true;
}

export function teamResults(room: Room): TeamResult[] {
  return Object.entries(room.decks).map(([team, deck]) => ({
    team,
    done: deck.done,
    total: deck.total,
    finishedAt: deck.finishedAt,
    bestStreak: deck.bestStreak,
  }));
}

export function finishRound(room: Room, at: number = Date.now()): void {
  if (room.state !== 'playing') return;
  room.endedAt = at;
  room.history.push({
    index: room.history.length + 1,
    startedAt: room.startedAt ?? at,
    endedAt: at,
    tally: structuredClone(room.tally),
    teams: teamResults(room),
    log: [...room.log],
  });
  room.state = 'finished';
  room.current = {};
  // The decks stay: the results screen reads each team's time from them.
}

export function resetRoom(room: Room): void {
  room.state = 'lobby';
  room.roundDeck = [];
  room.decks = {};
  room.finishOrder = [];
  room.current = {};
  room.log = [];
  room.tally = {};
  room.playerTally = {};
  room.startedAt = null;
  room.endsAt = null;
  room.endedAt = null;
}

export function clearHistory(room: Room): void {
  room.history = [];
}

/* --------------------------------------------------------------- scoring */

function emptyTable(room: Room): Map<string, TeamScore> {
  const table = new Map<string, TeamScore>();
  for (const team of room.teams) {
    table.set(team, { team, correct: 0, skipped: 0, score: 0, players: [] });
  }
  for (const player of room.players) {
    const row = player.team ? table.get(player.team) : undefined;
    if (row && !row.players.includes(player.name)) row.players.push(player.name);
  }
  return table;
}

/** Scores come from tallies, so they stay exact no matter how long a round runs. */
function scoreTallies(room: Room, tallies: Tally[]): TeamScore[] {
  const table = emptyTable(room);
  for (const tally of tallies) {
    for (const [team, counts] of Object.entries(tally)) {
      let row = table.get(team);
      if (!row) {
        // A team that has since been deleted still keeps the points it scored.
        row = { team, correct: 0, skipped: 0, score: 0, players: [] };
        table.set(team, row);
      }
      row.correct += counts.correct;
      row.skipped += counts.skipped;
    }
  }
  for (const row of table.values()) {
    row.score = row.correct - (room.settings.skipPenalty ? row.skipped : 0);
  }
  return [...table.values()].sort((a, b) => b.score - a.score || b.correct - a.correct);
}

/** This round: teams that finished lead, in finishing order; the rest by score. */
export function roundScores(room: Room): TeamScore[] {
  const place = (team: string) => {
    const i = room.finishOrder.indexOf(team);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return scoreTallies(room, [room.tally]).sort(
    (a, b) => place(a.team) - place(b.team) || b.score - a.score || b.correct - a.correct,
  );
}

export function totalScores(room: Room): TeamScore[] {
  const tallies = room.history.map((r) => r.tally);
  if (room.state === 'playing') tallies.push(room.tally);
  return scoreTallies(room, tallies);
}
