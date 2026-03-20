import { describe, it, expect } from 'vitest';
import { selectWinner, MIN_MEANINGFUL_SCORE } from './select-winner.js';
import type { ScoredCandidate } from './types.js';

describe('select-winner', () => {
  it('selects highest scoring candidate, lowConfidence=false', () => {
    const candidates: ScoredCandidate[] = [
      { score: 100, url: 'a', headers: {}, mediaType: 'hls', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: null },
      { score: 50, url: 'b', headers: {}, mediaType: 'hls', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: null }
    ];
    
    const result = selectWinner(candidates);
    expect(result?.winner.score).toBe(100);
    expect(result?.lowConfidence).toBe(false);
    expect(result?.runnerUpScore).toBe(50);
    expect(result?.candidateCount).toBe(2);
  });

  it('tie-breaks by higher bitrate when scores match', () => {
    const candidates: ScoredCandidate[] = [
      { score: 80, url: 'a', headers: {}, mediaType: 'hls', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: 2000000 },
      { score: 80, url: 'b', headers: {}, mediaType: 'hls', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: 5000000 }
    ];
    
    const result = selectWinner(candidates);
    expect(result?.winner.bitrate).toBe(5000000);
  });

  it('tie-breaks by earlier capturedAt when scores and bitrates match', () => {
    const candidates: ScoredCandidate[] = [
      { score: 80, url: 'a', headers: {}, mediaType: 'hls', capturedAt: 2000, area: null, muted: false, precededByEndedStream: false, bitrate: 2000000 },
      { score: 80, url: 'b', headers: {}, mediaType: 'hls', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: 2000000 }
    ];
    
    const result = selectWinner(candidates);
    expect(result?.winner.capturedAt).toBe(1000);
  });

  it('sets lowConfidence=true when all candidates are below threshold', () => {
    const candidates: ScoredCandidate[] = [
      { score: -10, url: 'a', headers: {}, mediaType: 'hls', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: null },
      { score: -20, url: 'b', headers: {}, mediaType: 'hls', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: null }
    ];
    
    const result = selectWinner(candidates);
    expect(result?.winner.score).toBe(-10);
    expect(result?.lowConfidence).toBe(true);
  });

  it('returns null for empty array', () => {
    const result = selectWinner([]);
    expect(result).toBeNull();
  });
});
