import { kvDel, kvGet, kvSet, kvSetAdd, kvSetMembers, kvSetRemove, withLock } from './store';
import { HttpError } from './errors';
import { makeRoom, roomCode, seedBank, settle } from './rules';
import type { Bank, Room } from './types';

/** Pure game rules live in ./rules so they stay independent of storage. */
export * from './rules';

const BANK_KEY = 'charade:bank';
/** Index of every open room, so an admin can see and close them. */
const ROOM_INDEX_KEY = 'charade:rooms';

const roomKey = (code: string) => `charade:room:${code.toUpperCase()}`;

/** Rooms this process has already put in the index — saves a write per save. */
const indexed = new Set<string>();

/* ------------------------------------------------------------------ bank */

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

/* ------------------------------------------------------------------ room */

export async function getRoom(code: string): Promise<Room | null> {
  if (!code) return null;
  return kvGet<Room>(roomKey(code));
}

/**
 * Rooms are stored with no expiry on purpose: an admin closing one from Manage
 * rooms is the only thing that ever removes a room. Nothing here times out, and
 * an empty room keeps its code, teams and scores until somebody closes it.
 */
export async function saveRoom(room: Room): Promise<Room> {
  room.updatedAt = Date.now();
  await kvSet(roomKey(room.code), room);
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

export async function createRoom(hostName: string): Promise<Room> {
  const bank = await getBank();
  let code = roomCode();
  for (let attempt = 0; attempt < 8 && (await getRoom(code)); attempt += 1) code = roomCode();
  return saveRoom(makeRoom(code, hostName, bank.categories.map((c) => c.id)));
}
