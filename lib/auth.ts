import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors';
import type { Player, Room } from './types';

/**
 * Player credentials.
 *
 * A player's `id` is public: every screen in the room receives it, because it
 * is how people are listed and how an admin points at someone to remove them.
 * An identifier everyone can see cannot also prove who you are. So each player
 * also gets a `secret` — a random bearer token handed only to them when they
 * join and kept in their own browser — and every action taken as that player
 * must present it.
 *
 * Only a SHA-256 hash is stored, so the database never holds a usable
 * credential. Hashes are compared in constant time so response timing reveals
 * nothing about how close a guess was.
 */

export function newSecret(): { secret: string; hash: string } {
  const secret = randomBytes(24).toString('base64url');
  return { secret, hash: hashSecret(secret) };
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url');
}

function matches(player: Player, secret: unknown): boolean {
  if (!player.secretHash || typeof secret !== 'string' || !secret) return false;
  const given = Buffer.from(hashSecret(secret));
  const stored = Buffer.from(player.secretHash);
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/** The player these credentials belong to, or null. Never throws. */
export function authenticate(room: Room, playerId: unknown, secret: unknown): Player | null {
  if (typeof playerId !== 'string' || !playerId) return null;
  const player = room.players.find((p) => p.id === playerId);
  return player && matches(player, secret) ? player : null;
}

/** For actions that only make sense as a specific player. */
export function requireAuthenticated(room: Room, playerId: unknown, secret: unknown): Player {
  const player = authenticate(room, playerId, secret);
  if (!player) throw new HttpError(403, 'Your place in this room has expired — please join again');
  return player;
}
