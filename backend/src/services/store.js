import dotenv from 'dotenv';

dotenv.config();

// Optional Redis import guarded at runtime
let RedisImpl = null;
try {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  RedisImpl = (await import('ioredis')).default;
} catch (_) {
  RedisImpl = null;
}

const REDIS_URL = process.env.REDIS_URL;
const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL_SECONDS || '86400', 10);

// In-memory fallback store
const memoryStore = new Map(); // key -> { items: string[], timeout: NodeJS.Timeout | null, expiresAt: number }

function touchExpiry(key) {
  const entry = memoryStore.get(key);
  if (!entry) return;
  if (entry.timeout) clearTimeout(entry.timeout);
  entry.expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  entry.timeout = setTimeout(() => {
    memoryStore.delete(key);
  }, SESSION_TTL_SECONDS * 1000);
}

class MemoryAdapter {
  async lrange(key, start, end) {
    const entry = memoryStore.get(key);
    if (!entry) return [];
    const arr = entry.items || [];
    const normalizedEnd = end === -1 ? arr.length - 1 : end;
    return arr.slice(start, normalizedEnd + 1);
  }
  async rpush(key, value) {
    const entry = memoryStore.get(key) || { items: [], timeout: null, expiresAt: 0 };
    entry.items.push(value);
    memoryStore.set(key, entry);
    touchExpiry(key);
  }
  async del(key) {
    const entry = memoryStore.get(key);
    if (entry?.timeout) clearTimeout(entry.timeout);
    memoryStore.delete(key);
  }
  async expire(key, seconds) {
    // Reset TTL
    const entry = memoryStore.get(key) || { items: [], timeout: null, expiresAt: 0 };
    memoryStore.set(key, entry);
    if (entry.timeout) clearTimeout(entry.timeout);
    entry.timeout = setTimeout(() => {
      memoryStore.delete(key);
    }, seconds * 1000);
    entry.expiresAt = Date.now() + seconds * 1000;
  }
}

let client = null;
let usingRedis = false;
if (REDIS_URL && RedisImpl) {
  try {
    // Disable automatic retries and connect lazily
    client = new RedisImpl(REDIS_URL, {
      lazyConnect: true,
      retryStrategy: null,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    });
    // attach silent error handler to avoid spam
    client.on('error', () => {});
    // Try a fast connect + ping. If it fails, fall back immediately.
    await client.connect();
    await client.ping();
    usingRedis = true;
  } catch (_) {
    try { if (client) await client.quit(); } catch (_) {}
    usingRedis = false;
    client = new MemoryAdapter();
  }
} else {
  client = new MemoryAdapter();
}

export const store = {
  usingRedis,
  SESSION_TTL_SECONDS,
  async getHistory(sessionId) {
    const items = await client.lrange(`chat:${sessionId}`, 0, -1);
    return items.map((i) => JSON.parse(i));
  },
  async append(sessionId, messageObj) {
    const key = `chat:${sessionId}`;
    await client.rpush(key, JSON.stringify(messageObj));
    await client.expire(key, SESSION_TTL_SECONDS);
  },
  async clear(sessionId) {
    await client.del(`chat:${sessionId}`);
  },
};




