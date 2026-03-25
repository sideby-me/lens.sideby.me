import { describe, it, expect } from 'vitest';
import { scoreCandidate, filterMutedCandidates } from './scorer.js';
import type { Candidate, ManifestInfo, ScoreContext } from './types.js';

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    url: 'https://example.com/seg001.ts',
    headers: {},
    mediaType: 'hls',
    capturedAt: 1000,
    area: null,
    muted: false,
    precededByEndedStream: false,
    bitrate: null,
    ...overrides,
  };
}

function makeManifest(overrides: Partial<ManifestInfo> = {}): ManifestInfo {
  return {
    isLive: false,
    duration: 120,
    hasAudioTrack: false,
    encrypted: false,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ScoreContext> = {}): ScoreContext {
  return {
    maxObservedArea: 1000,
    navigationStart: 0,
    candidateCount: 1,
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  describe('SIG-01: Area scoring', () => {
    it('area=500, maxObservedArea=1000 -> contributes 25', () => {
      const c = makeCandidate({ area: 500, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 1000, navigationStart: 0 });
      // capturedAt=0, navStart=0 -> elapsed=0 -> no timing bonus
      // no manifest -> no duration/audio signals
      // no post-ad
      expect(scoreCandidate(c, null, ctx)).toBe(25);
    });

    it('area=1000, maxObservedArea=1000 -> contributes 50', () => {
      const c = makeCandidate({ area: 1000, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 1000, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(50);
    });

    it('area=0, maxObservedArea=1000 -> contributes 0', () => {
      const c = makeCandidate({ area: 0, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 1000, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(0);
    });

    it('area=null -> contributes 0 (null-guarded)', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 1000, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(0);
    });

    it('maxObservedArea=0 -> contributes 0 (avoid division by zero)', () => {
      const c = makeCandidate({ area: 500, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(0);
    });
  });

  describe('SIG-03: Capture timing', () => {
    it('capturedAt=4000, navigationStart=0 -> +15 (elapsed > 3000)', () => {
      const c = makeCandidate({ area: null, capturedAt: 4000 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(15);
    });

    it('capturedAt=3001, navigationStart=0 -> +15 (elapsed > 3000)', () => {
      const c = makeCandidate({ area: null, capturedAt: 3001 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(15);
    });

    it('capturedAt=3000, navigationStart=0 -> +7 (elapsed == 3000, not > 3000)', () => {
      const c = makeCandidate({ area: null, capturedAt: 3000 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(7);
    });

    it('capturedAt=2000, navigationStart=0 -> +7 (elapsed > 1500)', () => {
      const c = makeCandidate({ area: null, capturedAt: 2000 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(7);
    });

    it('capturedAt=1501, navigationStart=0 -> +7 (elapsed > 1500)', () => {
      const c = makeCandidate({ area: null, capturedAt: 1501 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(7);
    });

    it('capturedAt=1000, navigationStart=0 -> +0 (elapsed <= 1500)', () => {
      const c = makeCandidate({ area: null, capturedAt: 1000 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(0);
    });

    it('capturedAt=1500, navigationStart=0 -> +0 (elapsed == 1500, not > 1500)', () => {
      const c = makeCandidate({ area: null, capturedAt: 1500 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(0);
    });

    it('capturedAt=5000, navigationStart=2000 -> elapsed=3000, NOT > 3000 -> +7', () => {
      const c = makeCandidate({ area: null, capturedAt: 5000 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 2000 });
      expect(scoreCandidate(c, null, ctx)).toBe(7);
    });
  });

  describe('SIG-04: Duration scoring (VOD only)', () => {
    it('duration=50, isLive=false -> -30 (< 90s)', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      const m = makeManifest({ isLive: false, duration: 50, hasAudioTrack: false });
      expect(scoreCandidate(c, m, ctx)).toBe(-30);
    });

    it('duration=89, isLive=false -> -30 (< 90s)', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      const m = makeManifest({ isLive: false, duration: 89, hasAudioTrack: false });
      expect(scoreCandidate(c, m, ctx)).toBe(-30);
    });

    it('duration=90, isLive=false -> 0 (not < 90, not > 180)', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      const m = makeManifest({ isLive: false, duration: 90, hasAudioTrack: false });
      expect(scoreCandidate(c, m, ctx)).toBe(0);
    });

    it('duration=180, isLive=false -> 0 (not > 180)', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      const m = makeManifest({ isLive: false, duration: 180, hasAudioTrack: false });
      expect(scoreCandidate(c, m, ctx)).toBe(0);
    });

    it('duration=200, isLive=false -> +20 (> 180s)', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      const m = makeManifest({ isLive: false, duration: 200, hasAudioTrack: false });
      expect(scoreCandidate(c, m, ctx)).toBe(20);
    });

    it('duration=181, isLive=false -> +20 (> 180s)', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      const m = makeManifest({ isLive: false, duration: 181, hasAudioTrack: false });
      expect(scoreCandidate(c, m, ctx)).toBe(20);
    });

    it('duration=50, isLive=true -> 0 (live bypass, SIG-05 skips duration)', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      const m = makeManifest({ isLive: true, duration: 50, hasAudioTrack: false });
      expect(scoreCandidate(c, m, ctx)).toBe(0);
    });

    it('manifest=null -> 0 (no manifest data)', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(0);
    });
  });

  describe('SIG-06: Audio track', () => {
    it('hasAudioTrack=true -> +10', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      const m = makeManifest({ isLive: false, duration: 120, hasAudioTrack: true });
      expect(scoreCandidate(c, m, ctx)).toBe(10);
    });

    it('hasAudioTrack=false -> +0', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      const m = makeManifest({ isLive: false, duration: 120, hasAudioTrack: false });
      expect(scoreCandidate(c, m, ctx)).toBe(0);
    });

    it('manifest=null -> +0 (no manifest)', () => {
      const c = makeCandidate({ area: null, capturedAt: 0 });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(0);
    });
  });

  describe('SIG-07: Post-ad sequence', () => {
    it('precededByEndedStream=true -> +25', () => {
      const c = makeCandidate({ area: null, capturedAt: 0, precededByEndedStream: true });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(25);
    });

    it('precededByEndedStream=false -> +0', () => {
      const c = makeCandidate({ area: null, capturedAt: 0, precededByEndedStream: false });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      expect(scoreCandidate(c, null, ctx)).toBe(0);
    });
  });

  describe('Combined score', () => {
    it('all max signals -> 50+15+20+10+25 = 120', () => {
      const c = makeCandidate({
        area: 1000,
        capturedAt: 4000,
        precededByEndedStream: true,
      });
      const ctx = makeContext({ maxObservedArea: 1000, navigationStart: 0 });
      const m = makeManifest({ isLive: false, duration: 200, hasAudioTrack: true });
      expect(scoreCandidate(c, m, ctx)).toBe(120);
    });

    it('all min signals -> 0+0-30+0+0 = -30', () => {
      const c = makeCandidate({
        area: 0,
        capturedAt: 500,
        precededByEndedStream: false,
      });
      const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
      const m = makeManifest({ isLive: false, duration: 30, hasAudioTrack: false });
      expect(scoreCandidate(c, m, ctx)).toBe(-30);
    });
  });
});

describe('SIG-08: HLS playlist type', () => {
  it('M3U8 playlist URL with mediaType=hls -> +20 bonus', () => {
    const c = makeCandidate({
      url: 'https://cdn.example.com/stream.m3u8',
      mediaType: 'hls',
      area: null,
      capturedAt: 0,
    });
    const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
    expect(scoreCandidate(c, null, ctx)).toBe(20);
  });

  it('.ts segment URL with mediaType=hls (no .m3u8 in path) -> +0 bonus', () => {
    const c = makeCandidate({ url: 'https://cdn.example.com/seg001.ts', mediaType: 'hls', area: null, capturedAt: 0 });
    const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
    expect(scoreCandidate(c, null, ctx)).toBe(0);
  });

  it('.mp4 URL with mediaType=mp4 -> +0 bonus (SIG-08 only applies to HLS)', () => {
    const c = makeCandidate({ url: 'https://cdn.example.com/video.mp4', mediaType: 'mp4', area: null, capturedAt: 0 });
    const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
    expect(scoreCandidate(c, null, ctx)).toBe(0);
  });

  it('HLS URL with .m3u8 in path and query string -> +20 bonus (extension in path, not query)', () => {
    const c = makeCandidate({
      url: 'https://cdn.example.com/stream.m3u8?token=abc123',
      mediaType: 'hls',
      area: null,
      capturedAt: 0,
    });
    const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
    expect(scoreCandidate(c, null, ctx)).toBe(20);
  });

  it('combined: M3U8 playlist with area=0, capturedAt=0, no manifest -> exactly 20', () => {
    const c = makeCandidate({ url: 'https://cdn.example.com/index.m3u8', mediaType: 'hls', area: 0, capturedAt: 0 });
    const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
    expect(scoreCandidate(c, null, ctx)).toBe(20);
  });

  it('combined: .ts segment with area=0, capturedAt=0, no manifest -> exactly 0', () => {
    const c = makeCandidate({ url: 'https://cdn.example.com/seg001.ts', mediaType: 'hls', area: 0, capturedAt: 0 });
    const ctx = makeContext({ maxObservedArea: 0, navigationStart: 0 });
    expect(scoreCandidate(c, null, ctx)).toBe(0);
  });

  it('Behance bug scenario: .ts segment score=32 loses to M3U8 with identical signals', () => {
    // Simulate a .ts candidate with some signals giving score=32 (e.g. area + timing)
    const ctx = makeContext({ maxObservedArea: 1000, navigationStart: 0 });
    const tsCandidate = makeCandidate({
      url: 'https://cdn.adobe.com/chunk001.ts',
      mediaType: 'hls',
      area: 360, // 360/1000 * 50 = 18 points
      capturedAt: 3500, // > 3000 → +15 points. Total = 33
      precededByEndedStream: false,
    });
    const m3u8Candidate = makeCandidate({
      url: 'https://cdn.adobe.com/index.m3u8',
      mediaType: 'hls',
      area: 360, // same area
      capturedAt: 3500, // same timing
      precededByEndedStream: false,
    });
    const tsScore = scoreCandidate(tsCandidate, null, ctx);
    const m3u8Score = scoreCandidate(m3u8Candidate, null, ctx);
    expect(m3u8Score).toBeGreaterThan(tsScore);
    expect(m3u8Score - tsScore).toBe(20); // SIG-08 alone is the difference
  });
});

describe('filterMutedCandidates', () => {
  it('[muted, non-muted] -> returns [non-muted] only', () => {
    const muted = makeCandidate({ muted: true, url: 'https://example.com/muted.m3u8' });
    const nonMuted = makeCandidate({ muted: false, url: 'https://example.com/nonmuted.m3u8' });
    const result = filterMutedCandidates([muted, nonMuted]);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/nonmuted.m3u8');
  });

  it('[muted] (only candidate) -> returns [muted] (allowed)', () => {
    const muted = makeCandidate({ muted: true });
    const result = filterMutedCandidates([muted]);
    expect(result).toHaveLength(1);
    expect(result[0].muted).toBe(true);
  });

  it('[non-muted, non-muted] -> returns both', () => {
    const a = makeCandidate({ muted: false, url: 'https://example.com/a.m3u8' });
    const b = makeCandidate({ muted: false, url: 'https://example.com/b.m3u8' });
    const result = filterMutedCandidates([a, b]);
    expect(result).toHaveLength(2);
  });

  it('[] empty -> returns []', () => {
    expect(filterMutedCandidates([])).toHaveLength(0);
  });

  it('[muted, muted] -> returns both (all muted, allow all)', () => {
    const a = makeCandidate({ muted: true, url: 'https://example.com/a.m3u8' });
    const b = makeCandidate({ muted: true, url: 'https://example.com/b.m3u8' });
    const result = filterMutedCandidates([a, b]);
    expect(result).toHaveLength(2);
  });
});
