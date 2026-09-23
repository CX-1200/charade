import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tiny key/value store with three drivers, picked in this order:
 *
 *  - `redis`  : Upstash / Vercel KV REST credentials are present. Durable and
 *               shared by every serverless instance — the production answer.
 *  - `file`   : a writable disk (local dev, Docker, any long-lived Node host).
 *               State survives restarts, so an admin's question bank sticks.
 *  - `memory` : last resort. Lives in the process only: fine for a throwaway
 *               demo, lost on restart, not shared between instances.
 */

/**
 * Different providers inject different names for the same pair of values, so we
 * accept all the common ones rather than making people rename variables.
 */
const URL_VARS = [
  'UPSTASH_REDIS_REST_URL',
  'KV_REST_API_URL',
  'REDIS_REST_URL',
  'STORAGE_REST_URL',
] as const;
const TOKEN_VARS = [
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_TOKEN',
  'REDIS_REST_TOKEN',
  'STORAGE_REST_TOKEN',
] as const;

const pick = (names: readonly string[]) => {
  for (const name of names) {
    const value = (process.env[name] ?? '').trim();
    if (value) return { name, value };
  }
  return { name: '', value: '' };
};

const urlVar = pick(URL_VARS);
const tokenVar = pick(TOKEN_VARS);
const REDIS_URL = urlVar.value.replace(/\/+$/, '');
const REDIS_TOKEN = tokenVar.value;

/** Which env var names were actually found — reported by /api/health. */
export const detectedVars = {
  url: urlVar.name || null,
  token: tokenVar.name || null,
  looksLikeRedisUrl: /^rediss?:\/\//i.test(urlVar.value),
};

type Entry = { value: string; expiresAt: number | null };
type Bucket = Map<string, Entry>;

const globalForStore = globalThis as unknown as {
  __charadeMemory?: Bucket;
  __charadeLocks?: Map<string, Promise<unknown>>;
};

const memory: Bucket = (globalForStore.__charadeMemory ??= new Map());
const locks: Map<string, Promise<unknown>> = (globalForStore.__charadeLocks ??= new Map());

/* ------------------------------------------------------------ file driver */

const DATA_DIR = process.env.CHARADE_DATA_DIR || join(process.cwd(), '.data');
const DATA_FILE = join(DATA_DIR, 'charade.json');

/** True when this process can actually keep a file around between requests. */
function probeWritableDisk(): boolean {
  if (process.env.CHARADE_DISABLE_FILE_STORE === '1') return false;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const probe = join(DATA_DIR, '.probe');
    writeFileSync(probe, 'ok');
    unlinkSync(probe);
    return true;
  } catch {
    // Read-only filesystem (Vercel and most serverless runtimes) — fall back.
    return false;
  }
}

/**
 * The whole store is one small JSON file. Every access is synchronous, so a
 * read-modify-write cannot interleave with another request on Node's single
 * thread, and writes land through a rename so a crash cannot truncate the file.
 */
function readFileBucket(): Record<string, Entry> {
  try {
    if (!existsSync(DATA_FILE)) return {};
    return JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Record<string, Entry>;
  } catch {
    return {};
  }
}

function writeFileBucket(data: Record<string, Entry>): void {
  const tmp = `${DATA_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, DATA_FILE);
}

export const storeDriver: 'redis' | 'file' | 'memory' =
  REDIS_URL && REDIS_TOKEN ? 'redis' : probeWritableDisk() ? 'file' : 'memory';

/** Whether the active driver keeps data across a restart or redeploy. */
export const storeIsDurable = storeDriver !== 'memory';

export const storeLocation =
  storeDriver === 'redis' ? 'Redis (REST)' : storeDriver === 'file' ? DATA_FILE : 'process memory';

async function redisCommand(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Redis command failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result ?? null;
}

function live(entry: Entry | undefined): Entry | null {
  if (!entry) return null;
  return entry.expiresAt && entry.expiresAt < Date.now() ? null : entry;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  if (storeDriver === 'redis') {
    const raw = (await redisCommand(['GET', key])) as string | null;
    return raw ? (JSON.parse(raw) as T) : null;
  }
  if (storeDriver === 'file') {
    const entry = live(readFileBucket()[key]);
    return entry ? (JSON.parse(entry.value) as T) : null;
  }
  const entry = live(memory.get(key));
  if (!entry) memory.delete(key);
  return entry ? (JSON.parse(entry.value) as T) : null;
}

export async function kvSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const entry: Entry = {
    value: JSON.stringify(value),
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  };
  if (storeDriver === 'redis') {
    await redisCommand(
      ttlSeconds ? ['SET', key, entry.value, 'EX', ttlSeconds] : ['SET', key, entry.value],
    );
    return;
  }
  if (storeDriver === 'file') {
    const data = readFileBucket();
    data[key] = entry;
    writeFileBucket(data);
    return;
  }
  memory.set(key, entry);
}

export async function kvDel(key: string): Promise<void> {
  if (storeDriver === 'redis') {
    await redisCommand(['DEL', key]);
    return;
  }
  if (storeDriver === 'file') {
    const data = readFileBucket();
    delete data[key];
    writeFileBucket(data);
    return;
  }
  memory.delete(key);
}

/* ------------------------------------------------------------ set members */

/**
 * Small unordered set. Backed by a real Redis set so adding is one atomic
 * command with no read-modify-write — it runs on every room save.
 */
export async function kvSetAdd(key: string, member: string): Promise<void> {
  if (storeDriver === 'redis') {
    await redisCommand(['SADD', key, member]);
    return;
  }
  const current = new Set((await kvGet<string[]>(key)) ?? []);
  if (current.has(member)) return;
  current.add(member);
  await kvSet(key, [...current]);
}

export async function kvSetRemove(key: string, member: string): Promise<void> {
  if (storeDriver === 'redis') {
    await redisCommand(['SREM', key, member]);
    return;
  }
  const current = ((await kvGet<string[]>(key)) ?? []).filter((m) => m !== member);
  await kvSet(key, current);
}

export async function kvSetMembers(key: string): Promise<string[]> {
  if (storeDriver === 'redis') {
    return ((await redisCommand(['SMEMBERS', key])) as string[] | null) ?? [];
  }
  return (await kvGet<string[]>(key)) ?? [];
}

/* ------------------------------------------------------------------ locks */

const LOCK_TTL_SECONDS = 10;
const LOCK_RETRY_MS = 25;
const LOCK_MAX_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cross-instance lock. The in-process lock below only orders requests inside
 * one Node process; on serverless there are many, so without this two players
 * answering at the same moment can read the same room and write back over each
 * other — one answer silently vanishes. With 50 players that is constant.
 */
async function withRedisLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = `${key}:lock`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;

  for (;;) {
    const acquired = await redisCommand(['SET', lockKey, token, 'NX', 'EX', LOCK_TTL_SECONDS]);
    if (acquired) break;
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the room lock — please try again');
    }
    await sleep(LOCK_RETRY_MS + Math.floor(Math.random() * LOCK_RETRY_MS));
  }

  try {
    return await fn();
  } finally {
    // Only clear our own lock: a lock we already lost to expiry belongs to
    // someone else now, and deleting it would let a third writer in.
    const held = (await redisCommand(['GET', lockKey])) as string | null;
    if (held === token) await redisCommand(['DEL', lockKey]);
  }
}

/**
 * Serialises read-modify-write cycles for one key inside this process so two
 * concurrent taps on the same room cannot clobber each other's update.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Order within this process first, then across instances when shared.
  const body = storeDriver === 'redis' ? () => withRedisLock(key, fn) : fn;
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current);
  locks.set(key, chained);
  await previous.catch(() => {});
  try {
    return await body();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}


/**
 * Real round-trip against the active store. `/api/health` and the setup page
 * use it so a misconfigured Redis shows up as a clear failure rather than as
 * mysterious 500s during a game.
 */
export async function storePing(): Promise<{ ok: boolean; error?: string }> {
  const key = 'charade:__ping';
  try {
    await kvSet(key, { at: Date.now() }, 60);
    const back = await kvGet<{ at: number }>(key);
    await kvDel(key);
    if (!back?.at) return { ok: false, error: 'Wrote a probe value but could not read it back' };
    return { ok: true };
  } catch (error) {
    // Never echo the raw response — it can contain the credential.
    const message = error instanceof Error ? error.message : String(error);
    const status = message.match(/\((\d{3})\)/)?.[1];
    if (status === '401' || status === '403') {
      return { ok: false, error: 'Rejected by the store: the token is wrong or expired' };
    }
    if (status) return { ok: false, error: `Store responded with HTTP ${status}` };
    return { ok: false, error: 'Could not reach the store — check the URL' };
  }
}
