const poolStr = process.env.LENS_PROXY_POOL?.trim();

const _pool: string[] = poolStr
  ? poolStr.split(',').map(s => s.trim()).filter(Boolean)
  : [];

// Wrap-safe round-robin index
let _index = 0;

// Returns the next proxy server URL (round-robin) or null when the pool is empty.
export function getNextProxy(): string | null {
  if (!_pool.length) return null;
  const proxy = _pool[_index];
  _index = (_index + 1) % _pool.length;
  return proxy;
}

export function proxyPoolSize(): number {
  return _pool.length;
}
