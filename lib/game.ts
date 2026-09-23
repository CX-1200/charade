import { kvGet, kvSet, withLock } from './store';
import { HttpError } from './errors';
import { makeRoom, roomCode, seedBank, settle } from './rules';
import type { Bank, Room } from './types';

/** Pure game rules live in ./rules so the browser can run them too. */
export * from './rules';

const BANK_KEY = 'charade:bank';
/**
 * Rooms have no lifetime of their own: they survive an empty lobby and are
 * reusable the next day. This TTL is storage hygiene only — it is refreshed on
 * every write, so a room disappears solely after a month of total silence.
 */
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 30;

const roomKey = (code: string) => `charade:room:${code.toUpperCase()}`;

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
  const bank = await getBank();
  let code = roomCode();
  for (let attempt = 0; attempt < 8 && (await getRoom(code)); attempt += 1) code = roomCode();
  return saveRoom(makeRoom(code, hostName, bank.categories.map((c) => c.id)));
}
