import { Redis } from 'ioredis';

import type { TelemetryCorrelation } from './types.js';

export const UUID_BRIDGE_TTL_SECONDS = 3600;
export const UUID_BRIDGE_TTL = UUID_BRIDGE_TTL_SECONDS;

const UUID_BRIDGE_PREFIX = 'uuid-bridge:';
const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

type UuidBridgeCorrelation = TelemetryCorrelation & {
  traceparent?: string;
  baggage?: string;
};

interface KvLike {
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
}

type BridgeStorage = Redis | KvLike;

export interface UuidCorrelationRecord {
  traceparent: string;
  baggage?: string;
  request_id: string;
  dispatch_id: string;
  room_id?: string | null;
  user_id?: string | null;
  created_at: number;
  expires_at: number;
}

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  return redis;
}

function buildTraceparent(correlation: UuidBridgeCorrelation): string {
  if (correlation.traceparent && TRACEPARENT_RE.test(correlation.traceparent)) {
    return correlation.traceparent.toLowerCase();
  }

  const traceId = correlation.traceId?.toLowerCase();
  const spanId = correlation.spanId?.toLowerCase();
  if (traceId && spanId && traceId.length === 32 && spanId.length === 16) {
    return `00-${traceId}-${spanId}-01`;
  }

  return `00-${randomHex(32)}-${randomHex(16)}-01`;
}

function isKvLike(storage: BridgeStorage): storage is KvLike {
  return typeof (storage as KvLike).put === 'function';
}

function randomHex(length: number): string {
  let output = '';
  while (output.length < length) {
    output += Math.floor(Math.random() * 16).toString(16);
  }
  return output.slice(0, length);
}

/**
 * Store correlation context keyed by UUID for pipe recovery.
 */
export async function storeUuidCorrelation(
  uuid: string,
  correlation: UuidBridgeCorrelation,
  storage: BridgeStorage = getRedis()
): Promise<void> {
  const now = Date.now();
  const record: UuidCorrelationRecord = {
    traceparent: buildTraceparent(correlation),
    baggage: correlation.baggage,
    request_id: correlation.requestId ?? '',
    dispatch_id: correlation.dispatchId ?? '',
    room_id: correlation.roomId ?? null,
    user_id: correlation.userId ?? null,
    created_at: now,
    expires_at: now + UUID_BRIDGE_TTL_SECONDS * 1000,
  };

  const key = `${UUID_BRIDGE_PREFIX}${uuid}`;
  const payload = JSON.stringify(record);

  if (isKvLike(storage)) {
    await storage.put(key, payload, { expirationTtl: UUID_BRIDGE_TTL_SECONDS });
    return;
  }

  await storage.set(key, payload, 'EX', UUID_BRIDGE_TTL_SECONDS);
}

/**
 * Retrieve correlation context by UUID.
 */
export async function getUuidCorrelation(
  uuid: string,
  storage: BridgeStorage = getRedis()
): Promise<UuidCorrelationRecord | null> {
  const key = `${UUID_BRIDGE_PREFIX}${uuid}`;
  const data = await storage.get(key);
  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as UuidCorrelationRecord;
  } catch {
    return null;
  }
}