import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDefineCommand, mockIncrAndExpire } = vi.hoisted(() => ({
  mockDefineCommand: vi.fn(),
  mockIncrAndExpire: vi.fn(),
}));

vi.mock('ioredis', () => {
  class MockRedis {
    defineCommand = mockDefineCommand;
    incrAndExpire = mockIncrAndExpire;
  }
  return { Redis: MockRedis };
});

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('allows request when under the limit', async () => {
    mockIncrAndExpire.mockResolvedValue([1, 60_000]);
    const { checkRateLimit } = await import('../rate-limiter.js');

    const result = await checkRateLimit('room:abc', 3, 60_000);

    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('allows request exactly at the limit', async () => {
    mockIncrAndExpire.mockResolvedValue([3, 45_000]);
    const { checkRateLimit } = await import('../rate-limiter.js');

    const result = await checkRateLimit('room:abc', 3, 60_000);

    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('blocks request when limit is exceeded', async () => {
    mockIncrAndExpire.mockResolvedValue([4, 30_000]);
    const { checkRateLimit } = await import('../rate-limiter.js');

    const result = await checkRateLimit('room:abc', 3, 60_000);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(30_000);
  });

  it('returns retryAfterMs of 0 when pttl is negative', async () => {
    mockIncrAndExpire.mockResolvedValue([5, -1]);
    const { checkRateLimit } = await import('../rate-limiter.js');

    const result = await checkRateLimit('user:xyz', 3, 60_000);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(0);
  });

  it('passes the correct prefixed key to Redis', async () => {
    mockIncrAndExpire.mockResolvedValue([1, 60_000]);
    const { checkRateLimit } = await import('../rate-limiter.js');

    await checkRateLimit('room:test-room', 3, 60_000);

    expect(mockIncrAndExpire).toHaveBeenCalledWith('lens:rl:room:test-room', '60000');
  });
});
