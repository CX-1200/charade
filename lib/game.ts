import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kvDel, kvGet, kvSet, kvSetAdd, kvSetMembers, kvSetRemove, withLock } from './store';
import { HttpError } from './errors';
import { parseQuestionsCsv } from './csv';
import { CATEGORY_COLORS } from './ui';
import { id, makeRoom, normalizeRoom, roomCode, seedBank, settle } from './rules';
import type { Bank, Room } from './types';

/** Pure game rules live in ./rules so they stay independent of storage. */
export * from './rules';

const BANK_KEY = 'charade:bank';
/** Index of every open room, so an admin can see and close them. */
const ROOM_INDEX_KEY = 'charade:rooms';

const roomKey = (code: string) => `charade:room:${code.toUpperCase()}`;

/** Rooms this process has already put in the index — saves a write per save. */
const indexed = new Set<string>();

/**
 * Polls are most of the traffic: 60 browsers checking in every second or two.
 * Within one server instance, polls for the same room inside this window share
 * a single store read. Writes go through the cache, so a player always sees
 * their own answer; another instance's write shows up within the window.
 */
const READ_CACHE_MS = 750;
const readCache = new Map<string, { room: Room; at: number }>();

function remember(room: Room): void {
  readCache.set(room.code.toUpperCase(), {
    room: structuredClone(room),
    at: Date.now(),
  });
}

/** For read-only views. Anything that writes must use withRoom instead. */
export async function getRoomForRead(code: string): Promise<Room | null> {
  const key = code.toUpperCase();
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < READ_CACHE_MS) return structuredClone(hit.room);
  const room = await getRoom(key);
  if (room) remember(room);
  else readCache.delete(key);
  return room;
}

/* ------------------------------------------------------------ repo backup */

/**
 * The question bank's permanent copy lives in the repository as a CSV. It is
 * bundled with every deployment (see outputFileTracingIncludes), so whatever
 * happens to the database — a fresh Turso instance, an archived free tier, a
 * move between providers — the questions come back from here.
 */
export const REPO_BACKUP_PATH = 'data/questions.csv';

export function readRepoBackup() {
  try {
    const text = readFileSync(join(process.cwd(), REPO_BACKUP_PATH), 'utf8');
    const parsed = parseQuestionsCsv(text);
    return parsed.categories.length ? parsed : null;
  } catch {
    return null;
  }
}

function bankFromRepo(): Bank | null {
  const backup = readRepoBackup();
  if (!backup) return null;
  const now = Date.now();
  return {
    categories: backup.categories.map((category, index) => ({
      id: id('cat'),
      name: category.name,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      createdAt: now + index,
      items: category.items.map((text, i) => ({
        id: id('q'),
        text,
        createdAt: now + i,
      })),
    })),
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ bank */

/**
 * The stored bank always wins. Only an empty store — never a deploy — loads
 * the repository copy, so editing questions on the site and then shipping new
 * code can never wipe those edits. Restoring from the repo is a deliberate
 * admin action (restoreFromRepo in the bank route).
 */
export async function getBank(): Promise<Bank> {
  const stored = await kvGet<Bank>(BANK_KEY);
  if (stored?.categories) return stored;
  const fresh = bankFromRepo() ?? seedBank();
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

/* ------------------------------------------------------------------ room */

export async function getRoom(code: string): Promise<Room | null> {
  if (!code) return null;
  const room = await kvGet<Room>(roomKey(code));
  return room ? normalizeRoom(room) : null;
}

/**
 * Rooms are stored with no expiry on purpose: an admin closing one from Manage
 * rooms is the only thing that ever removes a room. Nothing here times out, and
 * an empty room keeps its code, teams and scores until somebody closes it.
 */
export async function saveRoom(room: Room): Promise<Room> {
  room.updatedAt = Date.now();
  await kvSet(roomKey(room.code), room);
  remember(room);
  // Idempotent, and it heals the index for rooms this instance has not seen —
  // but only once per room per process, since saves are the hot path.
  if (!indexed.has(room.code)) {
    await kvSetAdd(ROOM_INDEX_KEY, room.code);
    indexed.add(room.code);
  }
  return room;
}

/** The one and only way a room is destroyed. */
export async function closeRoom(code: string): Promise<boolean> {
  const upper = code.toUpperCase();
  const existed = !!(await getRoom(upper));
  await kvDel(roomKey(upper));
  await kvSetRemove(ROOM_INDEX_KEY, upper);
  indexed.delete(upper);
  readCache.delete(upper);
  return existed;
}

export async function listRooms(): Promise<Room[]> {
  const codes = await kvSetMembers(ROOM_INDEX_KEY);
  const rooms = await Promise.all(codes.map((code) => getRoom(code)));
  const open: Room[] = [];
  for (const [index, room] of rooms.entries()) {
    // A code in the index with no room behind it is stale — tidy it away.
    if (room) open.push(room);
    else await kvSetRemove(ROOM_INDEX_KEY, codes[index]);
  }
  return open.sort((a, b) => b.updatedAt - a.updatedAt);
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
    return saveRoom(room);
  });
}

/** The host's secret comes back once, here; only its hash is stored. */
export async function createRoom(hostName: string, hostSecretHash: string): Promise<Room> {
  const bank = await getBank();
  let code = roomCode();
  for (let attempt = 0; attempt < 8 && (await getRoom(code)); attempt += 1) code = roomCode();
  return saveRoom(
    makeRoom(
      code,
      hostName,
      bank.categories.map((c) => c.id),
      hostSecretHash,
    ),
  );
}
