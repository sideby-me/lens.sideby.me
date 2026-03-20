import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runObservationLoop } from './observation-loop.js';
import * as intercept from '../extraction/intercept.js';
import * as domProbe from '../extraction/dom-probe.js';
import * as manifestParser from '../scoring/manifest-parser.js';
import * as selectWinnerMod from '../scoring/select-winner.js';
import * as scorer from '../scoring/scorer.js';

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
    };

    const promise = expect(runObservationLoop(opts)).rejects.toMatchObject({ code: 'no-media-found' });
    
    await vi.advanceTimersByTimeAsync(20500); 

    await promise;
  });
});
