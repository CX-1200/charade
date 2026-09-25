import { countPrompts, roundScores, settle, totalScores } from './rules';
import type { Bank, LogEntry, Room, Tally } from './types';

function sum(tally: Tally): number {
  return Object.values(tally).reduce((n, t) => n + t.correct + t.skipped, 0);
}

/**
 * The live feed is shown on a public screen while other teams are still acting
 * out the very same questions, so the words stay hidden until the round ends.
 */
function feedEntry(entry: LogEntry, live: boolean): LogEntry {
  return live ? { ...entry, text: '', categoryName: '' } : entry;
}

/** Each racing team's progress, place and time, for the live screen and results. */
function race(room: Room, now: number) {
  const startedAt = room.startedAt;
  const stop = room.endedAt ?? now;
  const teams = Object.entries(room.decks).map(([team, deck]) => {
    const place = room.finishOrder.indexOf(team);
    const end = deck.finishedAt ?? stop;
    return {
      team,
      done: deck.done,
      total: deck.total,
      finishedAt: deck.finishedAt,
      place: place === -1 ? null : place + 1,
      streak: deck.streak,
      bestStreak: deck.bestStreak,
      elapsedMs: startedAt ? Math.max(0, end - startedAt) : 0,
    };
  });
  teams.sort(
    (a, b) =>
      (a.place ?? Infinity) - (b.place ?? Infinity) ||
      b.done - a.done ||
      a.team.localeCompare(b.team),
  );
  return {
    winner: room.finishOrder[0] ?? null,
    total: room.roundDeck.length,
    startedAt,
    endedAt: room.endedAt,
    teams,
  };
}

/** Everything the client is allowed to see — note the deck never leaves the server. */
export function publicRoom(
  room: Room,
  playerId?: string | null,
  opts: { admin?: boolean; bank?: Bank | null } = {},
) {
  const now = Date.now();
  const you = playerId ? (room.players.find((p) => p.id === playerId) ?? null) : null;
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
      startsInMs: room.startedAt ? Math.max(0, room.startedAt - now) : 0,
      answered: sum(room.tally),
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
    // Held back during the lead-in so nobody reads their card before "go".
    card: you && !(room.startedAt && now < room.startedAt) ? (room.current[you.id] ?? null) : null,
    myStats: you ? (room.playerTally[you.id] ?? { correct: 0, skipped: 0 }) : null,
    race: race(room, now),
    scores: { round: roundScores(room), total: totalScores(room) },
    log: room.log
      .slice(-60)
      .reverse()
      .map((e) => feedEntry(e, room.state === 'playing')),
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
