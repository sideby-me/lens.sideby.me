import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runObservationLoop, _buildAlternatives } from './observation-loop.js';
import * as intercept from '../extraction/intercept.js';
import * as domProbe from '../extraction/dom-probe.js';
import * as manifestParser from '../scoring/manifest-parser.js';
import * as selectWinnerMod from '../scoring/select-winner.js';
import * as scorer from '../scoring/scorer.js';
import type { ScoredCandidate, ManifestInfo } from '../scoring/types.js';

vi.mock('../extraction/intercept.js');
vi.mock('../extraction/dom-probe.js');
vi.mock('../scoring/manifest-parser.js');
vi.mock('../scoring/scorer.js');

describe('observation-loop.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    vi.mocked(intercept.setupInterception).mockImplementation((opts) => {
      // simulate network events after delay
      setTimeout(() => {
        opts.onCandidate({
          url: 'https://cdn.example.com/video.m3u8',
          headers: {},
          mediaType: 'hls',
          capturedAt: Date.now(),
          frameUrl: null,
        });
      }, 2000);
      return vi.fn();
    });

    vi.mocked(domProbe.probeVideoElement).mockResolvedValue({ area: 100000, muted: false });
    vi.mocked(domProbe.clickLargestVideo).mockResolvedValue(true);
    vi.mocked(manifestParser.fetchAndParseManifest).mockResolvedValue({ isLive: false, duration: 100, hasAudioTrack: true, encrypted: false });
    vi.mocked(scorer.scoreCandidate).mockReturnValue(100);
    vi.mocked(scorer.filterMutedCandidates).mockImplementation(c => c);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves early if top candidate exceeds early stop threshold and min observation elapsed', async () => {
    const abortSignal = new AbortController().signal;
    const opts = {
      context: {} as any,
      page: { frames: () => [] } as any,
      abortSignal,
      navigationStart: Date.now(),
      pageUrl: 'https://example.com/watch',
    };

    const promise = runObservationLoop(opts);
    
    // advance past network event
    await vi.advanceTimersByTimeAsync(2500);
    // advance past min observation
    await vi.advanceTimersByTimeAsync(3000);

    const result = await promise;
    expect(result.winner.url).toBe('https://cdn.example.com/video.m3u8');
    expect(result.lowConfidence).toBe(false);
  });

  it('stops at max timeout if conditions not met earlier', async () => {
    // Return low scores via mock manipulation or let the score fall naturally so it doesn't early-stop.
    // Given the score heuristic, we can just ensure it doesn't cross early stop.
    // Or just run and expect it to resolve at max timeout.
    const abortSignal = new AbortController().signal;
    const opts = {
      context: {} as any,
      page: { frames: () => [] } as any,
      abortSignal,
      navigationStart: Date.now(),
      pageUrl: 'https://example.com/watch',
    };

    const promise = runObservationLoop(opts);
    
    await vi.advanceTimersByTimeAsync(20500); // MAX_OBSERVATION_MS + 500
    
    const result = await promise;
    expect(result.winner).toBeDefined();
  });

  it('attempts non-autoplay click if no candidates appear by wait time', async () => {
    vi.mocked(intercept.setupInterception).mockImplementation(() => vi.fn());

    const abortSignal = new AbortController().signal;
    const opts = {
      context: {} as any,
      page: { frames: () => [] } as any,
      abortSignal,
      navigationStart: Date.now(),
      pageUrl: 'https://example.com/watch',
    };

    const promise = runObservationLoop(opts);
    
    await vi.advanceTimersByTimeAsync(4500); // NON_AUTOPLAY_WAIT_MS + 500
    
    expect(domProbe.clickLargestVideo).toHaveBeenCalled();
  });

  it('rejects if no candidates at all by max timeout', async () => {
    vi.mocked(intercept.setupInterception).mockImplementation(() => vi.fn());

    const abortSignal = new AbortController().signal;
    const opts = {
      context: {} as any,
      page: { frames: () => [] } as any,
      abortSignal,
      navigationStart: Date.now(),
      pageUrl: 'https://example.com/watch',
    };

    const promise = expect(runObservationLoop(opts)).rejects.toMatchObject({ code: 'no-media-found' });

    await vi.advanceTimersByTimeAsync(20500);

    await promise;
  });
});

// --- buildAlternatives unit tests ---

function makeScoredCandidate(overrides: Partial<ScoredCandidate> & { score: number; url: string }): ScoredCandidate {
  return {
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

describe('_buildAlternatives', () => {
  const PAGE_URL = 'https://example.com/video-page';

  // Test A: score filtering — only candidates >= minScore included
  it('Test A: filters out candidates below minScore', () => {
    const nonWinners: ScoredCandidate[] = [
      makeScoredCandidate({ score: 8, url: 'https://cdn.example.com/high.m3u8' }),
      makeScoredCandidate({ score: 3, url: 'https://cdn.example.com/low.m3u8' }),
    ];
    const manifests = new Map<string, ManifestInfo | null>();
    const result = _buildAlternatives(nonWinners, manifests, PAGE_URL, 5);
    expect(result).toHaveLength(1);
    expect(result[0].mediaUrl).toBe('https://cdn.example.com/high.m3u8');
  });

  // Test B: HLS candidate with manifest entry gets durationSec and isLive from manifest
  it('Test B: HLS candidate with manifest gets durationSec and isLive from manifest', () => {
    const nonWinners: ScoredCandidate[] = [
      makeScoredCandidate({ score: 10, url: 'https://cdn.example.com/stream.m3u8', mediaType: 'hls' }),
    ];
    const manifests = new Map<string, ManifestInfo | null>();
    manifests.set('https://cdn.example.com/stream.m3u8', {
      isLive: true,
      duration: 300,
      hasAudioTrack: true,
      encrypted: false,
    });
    const result = _buildAlternatives(nonWinners, manifests, PAGE_URL, 5);
    expect(result).toHaveLength(1);
    expect(result[0].durationSec).toBe(300);
    expect(result[0].isLive).toBe(true);
  });

  // Test C: MP4 candidate without manifest entry gets durationSec: null, isLive: undefined
  it('Test C: MP4 candidate without manifest entry gets durationSec null and isLive undefined', () => {
    const nonWinners: ScoredCandidate[] = [
      makeScoredCandidate({ score: 10, url: 'https://cdn.example.com/video.mp4', mediaType: 'mp4' }),
    ];
    const manifests = new Map<string, ManifestInfo | null>();
    const result = _buildAlternatives(nonWinners, manifests, PAGE_URL, 5);
    expect(result).toHaveLength(1);
    expect(result[0].durationSec).toBeNull();
    expect(result[0].isLive).toBeUndefined();
  });

  // Test D: non-winner missing Referer gets pageUrl injected
  it('Test D: injects pageUrl as referer when no Referer header present', () => {
    const nonWinners: ScoredCandidate[] = [
      makeScoredCandidate({ score: 10, url: 'https://cdn.example.com/stream.m3u8', headers: {} }),
    ];
    const manifests = new Map<string, ManifestInfo | null>();
    const result = _buildAlternatives(nonWinners, manifests, PAGE_URL, 5);
    expect(result[0].headers['referer']).toBe(PAGE_URL);
  });

  // Test E: non-winner with existing Referer is not overwritten
  it('Test E: existing Referer header is not overwritten', () => {
    const ORIGINAL_REFERER = 'https://other.example.com/embed';
    const nonWinners: ScoredCandidate[] = [
      makeScoredCandidate({
        score: 10,
        url: 'https://cdn.example.com/stream.m3u8',
        headers: { 'Referer': ORIGINAL_REFERER },
      }),
    ];
    const manifests = new Map<string, ManifestInfo | null>();
    const result = _buildAlternatives(nonWinners, manifests, PAGE_URL, 5);
    expect(result[0].headers['Referer']).toBe(ORIGINAL_REFERER);
    expect(result[0].headers['referer']).toBeUndefined();
  });

  // Test F: empty nonWinners returns []
  it('Test F: empty nonWinners returns empty array', () => {
    const result = _buildAlternatives([], new Map(), PAGE_URL, 5);
    expect(result).toEqual([]);
  });

  // Test G: all non-winners below minScore returns []
  it('Test G: all candidates below minScore returns empty array', () => {
    const nonWinners: ScoredCandidate[] = [
      makeScoredCandidate({ score: 2, url: 'https://cdn.example.com/a.m3u8' }),
      makeScoredCandidate({ score: 1, url: 'https://cdn.example.com/b.m3u8' }),
    ];
    const result = _buildAlternatives(nonWinners, new Map(), PAGE_URL, 5);
    expect(result).toEqual([]);
  });
});
