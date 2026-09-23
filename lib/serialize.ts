import { countPrompts, roundScores, settle, totalScores } from './rules';
import type { Bank, Room } from './types';

/** Everything the client is allowed to see — note the deck never leaves the server. */
export function publicRoom(
  room: Room,
  playerId?: string | null,
  opts: { admin?: boolean; bank?: Bank | null } = {},
) {
  const now = Date.now();
  const you = playerId ? room.players.find((p) => p.id === playerId) ?? null : null;
  return {
    now,
    admin: !!opts.admin,
    room: {
      code: room.code,
      hostId: room.hostId,
      state: room.state,
      settings: room.settings,
      teams: room.teams,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        isHost: p.id === room.hostId,
        online: now - p.lastSeen < 20_000,
      })),
      startedAt: room.startedAt,
      endsAt: room.endsAt,
      remainingMs: room.endsAt ? Math.max(0, room.endsAt - now) : 0,
      answered: room.log.length,
      deckSize: room.deck.length,
      promptCount: opts.bank ? countPrompts(opts.bank, room.settings.categoryIds) : null,
      rounds: room.history.length,
      updatedAt: room.updatedAt,
    },
    you: you && {
      id: you.id,
      name: you.name,
      team: you.team,
      isHost: you.id === room.hostId,
      playing: !!you.team && room.settings.activeTeams.includes(you.team),
      /** An admin with no team watches instead of answering. */
      spectating: !you.team && !!opts.admin,
    },
    card: you ? room.current[you.id] ?? null : null,
    myStats: you
      ? {
          correct: room.log.filter((l) => l.playerId === you.id && l.result === 'correct').length,
          skipped: room.log.filter((l) => l.playerId === you.id && l.result === 'skip').length,
        }
      : null,
    scores: { round: roundScores(room), total: totalScores(room) },
    log: room.log.slice(-60).reverse(),
  };
}

export function settleAndSerialize(
  room: Room,
  playerId?: string | null,
  opts: { admin?: boolean; bank?: Bank | null } = {},
) {
  settle(room);
  return publicRoom(room, playerId, opts);
}

export type RoomView = ReturnType<typeof publicRoom>;
