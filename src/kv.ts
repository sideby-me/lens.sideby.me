import type { LensPayload } from './types.js';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

// Write a LensPayload to Cloudflare KV via REST API.
export async function putKV(uuid: string, payload: LensPayload, expiresAt: number): Promise<void> {
  const accountId = env('CF_ACCOUNT_ID');
  const namespaceId = env('CF_KV_NAMESPACE_ID');
  const apiToken = env('CF_API_TOKEN');
  const maxTtlMs = Number(process.env.LENS_KV_MAX_TTL_MS ?? 3_600_000);

  const ttlMs = Math.min(expiresAt - Date.now(), maxTtlMs);
  const ttlSeconds = Math.ceil(ttlMs / 1000); // always token-derived; never artificially floored
  if (ttlSeconds <= 0) {
    throw new Error(`KV write aborted: computed TTL is ${ttlSeconds}s (token already expired)`);
  }

  const url = `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${uuid}?expiration_ttl=${ttlSeconds}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`KV PUT failed (${res.status}): ${body}`);
  }
}

// Read a LensPayload from Cloudflare KV via REST API
export async function readKV(uuid: string): Promise<LensPayload | null> {
  const accountId = env('CF_ACCOUNT_ID');
  const namespaceId = env('CF_KV_NAMESPACE_ID');
  const apiToken = env('CF_API_TOKEN');

  const url = `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${uuid}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`KV GET failed (${res.status}): ${body}`);
  }

  return (await res.json()) as LensPayload;
}
