import { describe, it, expect, beforeEach } from 'vitest';
import { CandidateStore } from './candidate-store.js';
import type { Candidate } from './types.js';

function makeCandidate(url: string): Candidate {
  return {
    url,
    headers: {},
    mediaType: 'hls',
    capturedAt: Date.now(),
    area: null,
    muted: false,
    precededByEndedStream: false,
    bitrate: null,
  };
}

describe('CandidateStore', () => {
  let store: CandidateStore;

  beforeEach(() => {
    store = new CandidateStore();
  });

  it('add() followed by list() returns the added candidate', () => {
    const c = makeCandidate('https://example.com/stream.m3u8');
    store.add(c);
    const result = store.list();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(c);
  });

  it('add() three candidates then list() returns all three in insertion order', () => {
    const c1 = makeCandidate('https://example.com/a.m3u8');
    const c2 = makeCandidate('https://example.com/b.m3u8');
    const c3 = makeCandidate('https://example.com/c.m3u8');
    store.add(c1);
    store.add(c2);
    store.add(c3);
    const result = store.list();
    expect(result).toHaveLength(3);
    expect(result[0].url).toBe('https://example.com/a.m3u8');
    expect(result[1].url).toBe('https://example.com/b.m3u8');
    expect(result[2].url).toBe('https://example.com/c.m3u8');
  });

  it('list() on empty store returns empty array', () => {
    expect(store.list()).toEqual([]);
  });

  it('list() returns a defensive copy — mutating returned array does not affect store', () => {
    const c = makeCandidate('https://example.com/stream.m3u8');
    store.add(c);
    const result = store.list();
    result.push(makeCandidate('https://attacker.com/fake.m3u8'));
    expect(store.count()).toBe(1);
    expect(store.list()).toHaveLength(1);
  });

  it('count() returns 0 for empty store', () => {
    expect(store.count()).toBe(0);
  });

  it('count() returns N for N added candidates', () => {
    store.add(makeCandidate('https://example.com/a.m3u8'));
    store.add(makeCandidate('https://example.com/b.m3u8'));
    expect(store.count()).toBe(2);
  });
});
