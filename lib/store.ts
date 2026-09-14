/**
 * Tiny key/value store with two drivers:
 *
 *  - `redis`  : used when Upstash / Vercel KV REST credentials are present.
 *               State is shared by every serverless instance, which is what you
 *               want for real multi-device play on Vercel.
 *  - `memory` : zero-config fallback for local dev and quick demos. State lives
 *               in the Node process, so it is lost on restart and is not shared
 *               between serverless instances.
 */

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

export const storeDriver: 'redis' | 'memory' = REDIS_URL && REDIS_TOKEN ? 'redis' : 'memory';

type MemoryBucket = Map<string, { value: string; expiresAt: number | null }>;

const globalForStore = globalThis as unknown as {
  __charadeMemory?: MemoryBucket;
  __charadeLocks?: Map<string, Promise<unknown>>;
};

const memory: MemoryBucket = (globalForStore.__charadeMemory ??= new Map());
const locks: Map<string, Promise<unknown>> = (globalForStore.__charadeLocks ??= new Map());

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

export async function kvGet<T>(key: string): Promise<T | null> {
  if (storeDriver === 'redis') {
    const raw = (await redisCommand(['GET', key])) as string | null;
    return raw ? (JSON.parse(raw) as T) : null;
  }
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt && hit.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return JSON.parse(hit.value) as T;
}

export async function kvSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const raw = JSON.stringify(value);
  if (storeDriver === 'redis') {
    await redisCommand(ttlSeconds ? ['SET', key, raw, 'EX', ttlSeconds] : ['SET', key, raw]);
    return;
  }
  memory.set(key, { value: raw, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
}

export async function kvDel(key: string): Promise<void> {
  if (storeDriver === 'redis') {
    await redisCommand(['DEL', key]);
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
