import { createHash } from 'crypto';
import { Redis } from 'ioredis';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }
  return redis;
}

const DEDUP_PREFIX = 'lens:dedup:';

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

// Check if a URL has already been captured recently
export async function dedupCheck(url: string): Promise<string | null> {
  const key = `${DEDUP_PREFIX}${hashUrl(url)}`;
  return getRedis().get(key);
}

// Record a URL→UUID mapping for dedup
export async function dedupSet(url: string, uuid: string): Promise<void> {
  const ttl = Number(process.env.LENS_DEDUP_TTL_S ?? 300);
  const key = `${DEDUP_PREFIX}${hashUrl(url)}`;
  await getRedis().set(key, uuid, 'EX', ttl);
}

// Delete a dedup key (used when cached UUID points to expired KV entry)
export async function dedupDelete(url: string): Promise<void> {
  const key = `${DEDUP_PREFIX}${hashUrl(url)}`;
  await getRedis().del(key);
}
