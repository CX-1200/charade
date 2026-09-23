'use client';

/**
 * Single-device demo engine.
 *
 * On a deployment with no shared storage, every serverless instance keeps its
 * own rooms, so a room created by one request is invisible to the next. Demo
 * mode sidesteps that by running the very same game rules (lib/rules) in the
 * browser against localStorage: one device, no server, no setup.
 *
 * It answers the same request shapes as the API routes, so the UI is unchanged.
 * What it does NOT do is let a second device join — that genuinely needs the
 * shared store.
 */

import { HttpError } from './errors';
import {
  answer,
  applySettings,
  buildDeck,
  clean,
  clearHistory,
  createTeam,
  exportBank,
  finishRound,
  importBank,
  joinRoom,
  joinTeam,
  makeRoom,
  removePlayer,
  removeTeam,
  renamePlayer,
  requirePlayer,
  resetRoom,
  roomCode,
  seedBank,
  setTeamActive,
  settle,
  startRound,
  touch,
  CATEGORY_COLORS,
  id,
} from './rules';
import { publicRoom } from './serialize';
import type { Bank, Room } from './types';

const FLAG_KEY = 'charade:demoMode';
const BANK_KEY = 'charade:demo:bank';
const ROOM_KEY = (code: string) => `charade:demo:room:${code.toUpperCase()}`;

/* ------------------------------------------------------------------ flag */

export function isDemoMode(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** `storage` events only fire in other tabs, so announce the change here too. */
export const DEMO_EVENT = 'charade:demo-mode';

export function setDemoMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG_KEY, '1');
    else localStorage.removeItem(FLAG_KEY);
  } catch {
    /* private browsing — demo mode simply stays off */
  }
  window.dispatchEvent(new Event(DEMO_EVENT));
}

/* --------------------------------------------------------------- storage */

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new HttpError(507, 'This browser is out of local storage for demo mode');
  }
}

function getBank(): Bank {
  const stored = read<Bank>(BANK_KEY);
  if (stored?.categories) return stored;
  const fresh = seedBank();
  write(BANK_KEY, fresh);
  return fresh;
}

function saveBank(bank: Bank): Bank {
  bank.updatedAt = Date.now();
  write(BANK_KEY, bank);
  return bank;
}

function getRoom(code: string): Room | null {
  return code ? read<Room>(ROOM_KEY(code)) : null;
}

function saveRoom(room: Room): Room {
  room.updatedAt = Date.now();
  write(ROOM_KEY(room.code), room);
  return room;
}

/**
 * In demo mode everything happens in one browser, so "is this an admin" is just
 * "did this browser unlock admin". The server still issues that token; there is
 * simply nobody else here to protect the settings from.
 */
function hasAdminToken(token: unknown): boolean {
  return typeof token === 'string' && token.length > 0;
}

function requireAdmin(token: unknown): void {
  if (!hasAdminToken(token)) throw new HttpError(403, 'Admin access required');
}

const storage = { driver: 'demo' as const, durable: true };

/* ---------------------------------------------------------------- routes */

const ADMIN_ACTIONS = new Set([
  'settings',
  'removeTeam',
  'setTeamActive',
  'start',
  'finish',
  'reset',
  'clearHistory',
  'kick',
]);

function view(room: Room, playerId: string | null, admin: boolean) {
  return { ...publicRoom(room, playerId, { admin, bank: getBank() }), playerId };
}

/** Mirrors POST /api/rooms */
function createRoomHandler(body: Record<string, unknown>) {
  requireAdmin(body.adminToken);
  const name = clean(body.name, 20);
  if (!name) throw new HttpError(400, 'Please enter your name');
  let code = roomCode();
  for (let attempt = 0; attempt < 8 && getRoom(code); attempt += 1) code = roomCode();
  const bank = getBank();
  const room = saveRoom(makeRoom(code, name, bank.categories.map((c) => c.id)));
  const host = room.players[0];
  return { ...view(room, host.id, true), code: room.code };
}

/** Mirrors GET /api/rooms/[code] */
function roomView(code: string, playerId: string | null, adminToken: string | null) {
  const room = getRoom(code);
  if (!room) throw new HttpError(404, 'Room not found');
  touch(room, playerId);
  settle(room);
  saveRoom(room);
  return view(room, playerId, hasAdminToken(adminToken));
}

/** Mirrors POST /api/rooms/[code] */
function roomAction(code: string, body: Record<string, unknown>) {
  const action = String(body.action ?? '');
  const playerId = typeof body.playerId === 'string' ? body.playerId : null;
  const admin = hasAdminToken(body.adminToken);
  if (ADMIN_ACTIONS.has(action)) requireAdmin(body.adminToken);

  const room = getRoom(code);
  if (!room) throw new HttpError(404, 'Room not found');
  settle(room);
  touch(room, playerId);

  let joinedId: string | null = null;

  switch (action) {
    case 'join': {
      const existing = playerId ? room.players.find((p) => p.id === playerId) : null;
      joinedId = existing ? existing.id : joinRoom(room, clean(body.name, 20)).id;
      break;
    }
    case 'leave':
      if (playerId) removePlayer(room, playerId);
      break;
    case 'rename':
      renamePlayer(room, playerId ?? '', clean(body.name, 20));
      break;
    case 'joinTeam':
      joinTeam(room, playerId ?? '', clean(body.team, 16));
      break;
    case 'createTeam':
      requirePlayer(room, playerId ?? '');
      createTeam(room, playerId ?? '', clean(body.team, 16));
      break;
    case 'removeTeam':
      if (room.state === 'playing') throw new HttpError(409, 'Not while a round is running');
      removeTeam(room, clean(body.team, 16));
      break;
    case 'setTeamActive':
      if (room.state === 'playing') throw new HttpError(409, 'Not while a round is running');
      setTeamActive(room, clean(body.team, 16), body.active !== false);
      break;
    case 'settings':
      if (room.state === 'playing') {
        throw new HttpError(409, 'Settings cannot be changed mid-round');
      }
      applySettings(room, {
        durationSec: body.durationSec as number,
        categoryIds: body.categoryIds as string[],
        skipPenalty: body.skipPenalty as boolean,
      });
      break;
    case 'start':
      startRound(room, buildDeck(getBank(), room.settings.categoryIds));
      break;
    case 'answer':
      answer(room, playerId ?? '', body.result === 'skip' ? 'skip' : 'correct');
      break;
    case 'finish':
      finishRound(room);
      break;
    case 'reset':
      resetRoom(room);
      break;
    case 'clearHistory':
      clearHistory(room);
      resetRoom(room);
      break;
    case 'kick':
      removePlayer(room, String(body.targetId ?? ''));
      break;
    case 'ping':
      break;
    default:
      throw new HttpError(400, `Unknown action: ${action}`);
  }

  saveRoom(room);
  return view(room, joinedId ?? playerId, admin);
}

/** Mirrors the bank routes */
function bankAction(body: Record<string, unknown>) {
  requireAdmin(body.adminToken);
  const action = String(body.action ?? '');
  const bank = getBank();

  switch (action) {
    case 'addCategory': {
      const name = clean(body.name, 30);
      if (!name) throw new HttpError(400, 'Please enter a category name');
      if (bank.categories.some((c) => c.name === name)) {
        throw new HttpError(409, 'That category already exists');
      }
      bank.categories.push({
        id: id('cat'),
        name,
        color: CATEGORY_COLORS[bank.categories.length % CATEGORY_COLORS.length],
        items: [],
        createdAt: Date.now(),
      });
      break;
    }
    case 'renameCategory': {
      const category = bank.categories.find((c) => c.id === body.categoryId);
      if (!category) throw new HttpError(404, 'Category not found');
      const name = clean(body.name, 30);
      if (!name) throw new HttpError(400, 'Please enter a category name');
      category.name = name;
      break;
    }
    case 'deleteCategory':
      bank.categories = bank.categories.filter((c) => c.id !== body.categoryId);
      break;
    case 'addItems': {
      const category = bank.categories.find((c) => c.id === body.categoryId);
      if (!category) throw new HttpError(404, 'Category not found');
      const raw = Array.isArray(body.texts) ? body.texts : [body.text];
      const texts = raw
        .flatMap((value) => String(value ?? '').split(/[\n,，、]/))
        .map((value) => clean(value, 60))
        .filter(Boolean);
      if (!texts.length) throw new HttpError(400, 'Please enter at least one question');
      const existing = new Set(category.items.map((i) => i.text));
      for (const text of texts) {
        if (existing.has(text)) continue;
        existing.add(text);
        category.items.push({ id: id('q'), text, createdAt: Date.now() });
      }
      break;
    }
    case 'updateItem': {
      const category = bank.categories.find((c) => c.id === body.categoryId);
      const item = category?.items.find((i) => i.id === body.itemId);
      if (!item) throw new HttpError(404, 'Question not found');
      const text = clean(body.text, 60);
      if (!text) throw new HttpError(400, 'A question cannot be empty');
      item.text = text;
      break;
    }
    case 'deleteItem': {
      const category = bank.categories.find((c) => c.id === body.categoryId);
      if (!category) throw new HttpError(404, 'Category not found');
      category.items = category.items.filter((i) => i.id !== body.itemId);
      break;
    }
    case 'import':
      importBank(bank, body.data, body.mode === 'replace' ? 'replace' : 'merge');
      break;
    default:
      throw new HttpError(400, `Unknown action: ${action}`);
  }

  return { bank: saveBank(bank), storage };
}

/* --------------------------------------------------------------- routing */

/** Returns null when the request is not one demo mode handles. */
export function handleDemoRequest(
  url: string,
  init?: RequestInit,
): { status: number; data: unknown } | null {
  const [path, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  const method = (init?.method ?? 'GET').toUpperCase();
  const body =
    method === 'POST' && typeof init?.body === 'string'
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : {};

  const roomMatch = path.match(/^\/api\/rooms\/([^/]+)$/);

  try {
    if (path === '/api/bank' && method === 'GET') {
      const bank = getBank();
      return {
        status: 200,
        data: params.get('export') ? exportBank(bank) : { bank, storage },
      };
    }
    if (path === '/api/bank' && method === 'POST') return { status: 200, data: bankAction(body) };
    if (path === '/api/rooms' && method === 'POST') {
      return { status: 200, data: createRoomHandler(body) };
    }
    if (roomMatch && method === 'GET') {
      return {
        status: 200,
        data: roomView(roomMatch[1], params.get('playerId'), params.get('adminToken')),
      };
    }
    if (roomMatch && method === 'POST') {
      return { status: 200, data: roomAction(roomMatch[1], body) };
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Demo mode error';
    return { status, data: { error: message, ...(status === 404 ? { storage } : {}) } };
  }

  return null; // /api/admin and /api/health still go to the server
}
