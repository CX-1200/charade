import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from '@libsql/client';

/**
 * Tiny key/value store with four drivers, picked in this order:
 *
 *  - `turso`  : Turso / libSQL credentials are present. Hosted SQLite: durable,
 *               shared by every serverless instance, and a free tier large
 *               enough that this app will not exhaust it. The recommended one.
 *  - `redis`  : Upstash / Vercel KV REST credentials are present. Also durable
 *               and shared, but the free tier is tight for busy game nights.
 *  - `file`   : a writable disk (local dev, Docker, any long-lived Node host).
 *               State survives restarts on a single server.
 *  - `memory` : last resort. Lives in the process only: lost on restart, not
 *               shared between instances.
 *
 * Every driver implements the same small interface, so the rest of the app
 * never knows which one is live.
 */

/* ---------------------------------------------------------- configuration */

/**
 * Different providers inject different names for the same pair of values, so we
 * accept all the common ones rather than making people rename variables.
 */
const pick = (names: readonly string[]) => {
  for (const name of names) {
    const value = (process.env[name] ?? '').trim();
    if (value) return { name, value };
  }
  return { name: '', value: '' };
};

const tursoUrl = pick(['TURSO_DATABASE_URL', 'LIBSQL_URL', 'TURSO_URL']);
const tursoToken = pick(['TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN']);
const redisUrl = pick([
  'UPSTASH_REDIS_REST_URL',
  'KV_REST_API_URL',
  'REDIS_REST_URL',
  'STORAGE_REST_URL',
]);
const redisToken = pick([
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_TOKEN',
  'REDIS_REST_TOKEN',
  'STORAGE_REST_TOKEN',
]);

// A local `file:` libSQL URL needs no token; a remote one does.
const TURSO_READY = !!tursoUrl.value && (tursoUrl.value.startsWith('file:') || !!tursoToken.value);
const REDIS_READY = !!redisUrl.value && !!redisToken.value;

/** Which env var names were actually found — reported by /api/health. Never values. */
export const detectedVars = TURSO_READY || (tursoUrl.value && !REDIS_READY)
  ? {
      provider: 'turso' as const,
      url: tursoUrl.name || null,
      token: tursoToken.name || null,
      looksLikeRedisUrl: false,
    }
  : {
      provider: redisUrl.value ? ('redis' as const) : null,
      url: redisUrl.name || null,
      token: redisToken.name || null,
      looksLikeRedisUrl: /^rediss?:\/\//i.test(redisUrl.value),
    };

/* -------------------------------------------------------------- interface */

type Entry = { value: string; expiresAt: number | null };

type Driver = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  setAdd(key: string, member: string): Promise<void>;
  setRemove(key: string, member: string): Promise<void>;
  setMembers(key: string): Promise<string[]>;
  /**
   * Cross-instance mutual exclusion, for drivers shared between processes.
   * Local drivers leave it out: the in-process lock is all they need.
   */
  lock?<T>(key: string, fn: () => Promise<T>): Promise<T>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const LOCK_TTL_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_MAX_WAIT_MS = 10_000;

/** Shared retry loop: `tryAcquire` returns true once the lock is ours. */
async function acquireOrThrow(tryAcquire: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  while (!(await tryAcquire())) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the room lock — please try again');
    }
    await sleep(LOCK_RETRY_MS + Math.floor(Math.random() * LOCK_RETRY_MS));
  }
}

const lockToken = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/* ----------------------------------------------------------- turso driver */

/**
 * Hosted SQLite. The key/value model maps onto three tables: plain values,
 * set members, and locks. Every lookup is by primary key, which matters on
 * Turso: its free tier meters rows read, and a key lookup reads one row.
 */
function tursoDriver(): Driver {
  let client: Client | null = null;
  let ready: Promise<void> | null = null;

  const isLocalFile = tursoUrl.value.startsWith('file:');

  const db = async (): Promise<Client> => {
    if (!client) {
      // Imported lazily so the other drivers never load the libSQL client.
      const { createClient } = await import('@libsql/client');
      client = createClient({
        url: tursoUrl.value,
        authToken: tursoToken.value || undefined,
        // A local file is served by a pool of SQLite connections (20 by
        // default). They contend for the file's locks against each other, and
        // per-connection settings like busy_timeout only reach whichever one
        // ran them. Under load that left a connection holding the write lock
        // forever. One connection per process removes the contention; remote
        // Turso is unaffected, since its server does the serialising.
        ...(isLocalFile ? { concurrency: 1 } : {}),
      });
    }
    ready ??= (async () => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS kv (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL,
           expires_at INTEGER
         )`,
        `CREATE TABLE IF NOT EXISTS kv_set (
           key TEXT NOT NULL,
           member TEXT NOT NULL,
           PRIMARY KEY (key, member)
         )`,
        `CREATE TABLE IF NOT EXISTS kv_lock (
           key TEXT PRIMARY KEY,
           token TEXT NOT NULL,
           expires_at INTEGER NOT NULL
         )`,
      ];
      if (isLocalFile) {
        // WAL lets readers and the writer work side by side, and unlike
        // busy_timeout it is stored in the file, so every connection that ever
        // opens it — in any process — gets it.
        await client!.execute('PRAGMA journal_mode = WAL');
        // Wait for another process's write rather than failing at once.
        await client!.execute('PRAGMA busy_timeout = 5000');
      }
      for (const statement of statements) await client!.execute(statement);
    })().catch((error) => {
      ready = null; // let the next request retry the schema setup
      throw error;
    });
    await ready;
    return client;
  };

  return {
    async get(key) {
      const rs = await (await db()).execute({
        sql: 'SELECT value, expires_at FROM kv WHERE key = ?',
        args: [key],
      });
      const row = rs.rows[0];
      if (!row) return null;
      const expiresAt = row.expires_at as number | null;
      return expiresAt && expiresAt < Date.now() ? null : (row.value as string);
    },
    async set(key, value, ttlSeconds) {
      await (await db()).execute({
        sql: `INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
        args: [key, value, ttlSeconds ? Date.now() + ttlSeconds * 1000 : null],
      });
    },
    async del(key) {
      await (await db()).execute({ sql: 'DELETE FROM kv WHERE key = ?', args: [key] });
    },
    async setAdd(key, member) {
      await (await db()).execute({
        sql: 'INSERT INTO kv_set (key, member) VALUES (?, ?) ON CONFLICT DO NOTHING',
        args: [key, member],
      });
    },
    async setRemove(key, member) {
      await (await db()).execute({
        sql: 'DELETE FROM kv_set WHERE key = ? AND member = ?',
        args: [key, member],
      });
    },
    async setMembers(key) {
      const rs = await (await db()).execute({
        sql: 'SELECT member FROM kv_set WHERE key = ?',
        args: [key],
      });
      return rs.rows.map((row) => row.member as string);
    },
    async lock(key, fn) {
      const conn = await db();
      const token = lockToken();
      // One statement takes a free lock or steals an expired one; if someone
      // holds a live lock the WHERE fails and nothing changes (0 rows).
      await acquireOrThrow(async () => {
        const now = Date.now();
        try {
          const rs = await conn.execute({
            sql: `INSERT INTO kv_lock (key, token, expires_at) VALUES (?, ?, ?)
                  ON CONFLICT(key) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
                  WHERE kv_lock.expires_at < ?`,
            args: [key, token, now + LOCK_TTL_MS, now],
          });
          return rs.rowsAffected === 1;
        } catch (error) {
          // The database was momentarily busy: that is "not yet", not a failure.
          if (/SQLITE_BUSY|database is locked/i.test(String(error))) return false;
          throw error;
        }
      });
      try {
        return await fn();
      } finally {
        // Compare-and-delete in one statement: never release a lock that
        // expired and now belongs to someone else.
        await conn.execute({
          sql: 'DELETE FROM kv_lock WHERE key = ? AND token = ?',
          args: [key, token],
        });
      }
    },
  };
}

/* ----------------------------------------------------------- redis driver */

function redisDriver(): Driver {
  const base = redisUrl.value.replace(/\/+$/, '');

  async function command(cmd: (string | number)[]): Promise<unknown> {
    const res = await fetch(base, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisToken.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cmd),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Redis command failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (data.error) throw new Error(`Redis error: ${data.error}`);
    return data.result ?? null;
  }

  return {
    get: async (key) => (await command(['GET', key])) as string | null,
    set: async (key, value, ttl) => {
      await command(ttl ? ['SET', key, value, 'EX', ttl] : ['SET', key, value]);
    },
    del: async (key) => {
      await command(['DEL', key]);
    },
    setAdd: async (key, member) => {
      await command(['SADD', key, member]);
    },
    setRemove: async (key, member) => {
      await command(['SREM', key, member]);
    },
    setMembers: async (key) => ((await command(['SMEMBERS', key])) as string[] | null) ?? [],
    async lock(key, fn) {
      const lockKey = `${key}:lock`;
      const token = lockToken();
      await acquireOrThrow(async () =>
        !!(await command(['SET', lockKey, token, 'NX', 'PX', LOCK_TTL_MS])),
      );
      try {
        return await fn();
      } finally {
        // Only clear our own lock: one we lost to expiry is someone else's now.
        if ((await command(['GET', lockKey])) === token) await command(['DEL', lockKey]);
      }
    },
  };
}

/* ------------------------------------------------ file and memory drivers */

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
 * Both local drivers are a map of entries; they differ only in where the map
 * lives. The file variant rereads and rewrites one JSON file synchronously, so
 * a read-modify-write cannot interleave on Node's single thread, and it writes
 * through a rename so a crash cannot truncate the file.
 */
function bucketDriver(load: () => Record<string, Entry>, save: (d: Record<string, Entry>) => void): Driver {
  const live = (entry?: Entry) =>
    !entry || (entry.expiresAt && entry.expiresAt < Date.now()) ? null : entry;
  const readSet = (data: Record<string, Entry>, key: string): string[] => {
    const entry = live(data[key]);
    return entry ? (JSON.parse(entry.value) as string[]) : [];
  };
  const writeSet = (data: Record<string, Entry>, key: string, members: string[]) => {
    data[key] = { value: JSON.stringify(members), expiresAt: null };
  };

  return {
    get: async (key) => live(load()[key])?.value ?? null,
    set: async (key, value, ttl) => {
      const data = load();
      data[key] = { value, expiresAt: ttl ? Date.now() + ttl * 1000 : null };
      save(data);
    },
    del: async (key) => {
      const data = load();
      delete data[key];
      save(data);
    },
    setAdd: async (key, member) => {
      const data = load();
      const members = readSet(data, key);
      if (members.includes(member)) return;
      writeSet(data, key, [...members, member]);
      save(data);
    },
    setRemove: async (key, member) => {
      const data = load();
      writeSet(data, key, readSet(data, key).filter((m) => m !== member));
      save(data);
    },
    setMembers: async (key) => readSet(load(), key),
  };
}

function fileDriver(): Driver {
  return bucketDriver(
    () => {
      try {
        return existsSync(DATA_FILE)
          ? (JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Record<string, Entry>)
          : {};
      } catch {
        return {};
      }
    },
    (data) => {
      const tmp = `${DATA_FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, DATA_FILE);
    },
  );
}

const globalForStore = globalThis as unknown as {
  __charadeMemory?: Record<string, Entry>;
  __charadeLocks?: Map<string, Promise<unknown>>;
};

function memoryDriver(): Driver {
  const data = (globalForStore.__charadeMemory ??= {});
  return bucketDriver(
    () => data,
    () => {},
  );
}

/* ---------------------------------------------------------------- selection */

export const storeDriver: 'turso' | 'redis' | 'file' | 'memory' = TURSO_READY
  ? 'turso'
  : REDIS_READY
    ? 'redis'
    : probeWritableDisk()
      ? 'file'
      : 'memory';

const driver: Driver =
  storeDriver === 'turso'
    ? tursoDriver()
    : storeDriver === 'redis'
      ? redisDriver()
      : storeDriver === 'file'
        ? fileDriver()
        : memoryDriver();

/** Whether the active driver keeps data across a restart or redeploy. */
export const storeIsDurable = storeDriver !== 'memory';

/** Whether every server instance sees the same data. */
export const storeIsShared = storeDriver === 'turso' || storeDriver === 'redis';

export const storeLocation =
  storeDriver === 'turso'
    ? tursoUrl.value.startsWith('file:')
      ? 'libSQL (local file)'
      : 'Turso (libSQL)'
    : storeDriver === 'redis'
      ? 'Redis (REST)'
      : storeDriver === 'file'
        ? DATA_FILE
        : 'process memory';

/* ------------------------------------------------------------------ public */

export async function kvGet<T>(key: string): Promise<T | null> {
  const raw = await driver.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function kvSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  await driver.set(key, JSON.stringify(value), ttlSeconds);
}

export async function kvDel(key: string): Promise<void> {
  await driver.del(key);
}

/** Small unordered set; adding is idempotent. */
export const kvSetAdd = (key: string, member: string) => driver.setAdd(key, member);
export const kvSetRemove = (key: string, member: string) => driver.setRemove(key, member);
export const kvSetMembers = (key: string) => driver.setMembers(key);

const locks: Map<string, Promise<unknown>> = (globalForStore.__charadeLocks ??= new Map());

/**
 * Serialises read-modify-write cycles on one key. Requests inside this process
 * queue on an in-memory chain; shared drivers then also take a cross-instance
 * lock, because on serverless there are many processes and two simultaneous
 * answers could otherwise read the same room and write back over each other.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const body = driver.lock ? () => driver.lock!(key, fn) : fn;
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
 * use it so a misconfigured store shows up as a clear failure rather than as
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
    const status = message.match(/\((\d{3})\)/)?.[1] ?? message.match(/\b(401|403|404)\b/)?.[1];
    if (status === '401' || status === '403' || /unauthori[sz]ed|auth/i.test(message)) {
      return { ok: false, error: 'Rejected by the store: the token is wrong or expired' };
    }
    if (/archiv|blocked|suspend/i.test(message)) {
      return { ok: false, error: 'The database is archived or paused — unarchive it in its dashboard' };
    }
    if (status) return { ok: false, error: `Store responded with HTTP ${status}` };
    return { ok: false, error: 'Could not reach the store — check the URL' };
  }
}
