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

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

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

/**
 * Serialises read-modify-write cycles for one key inside this process so two
 * concurrent taps on the same room cannot clobber each other's update.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current);
  locks.set(key, chained);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}
