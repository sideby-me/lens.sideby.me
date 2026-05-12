import { Redis } from 'ioredis';

// Atomically increment a fixed-window counter and set its expiry on first use.
// Returns [count, pttl_ms].
const INCR_AND_EXPIRE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

declare module 'ioredis' {
  interface RedisCommander<_Context> {
    incrAndExpire(key: string, windowMs: string): Promise<[number, number]>;
  }
}

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    redis.defineCommand('incrAndExpire', {
      numberOfKeys: 1,
      lua: INCR_AND_EXPIRE_SCRIPT,
    });
  }
  return redis;
}

const RL_PREFIX = 'lens:rl:';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redisKey = `${RL_PREFIX}${key}`;
  const [count, pttl] = await getRedis().incrAndExpire(redisKey, String(windowMs));

  if (count > max) {
    return { allowed: false, retryAfterMs: Math.max(0, pttl) };
  }
  return { allowed: true, retryAfterMs: 0 };
}
