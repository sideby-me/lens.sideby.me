import { describe, it, expect } from 'vitest';
import { selectWinner, MIN_MEANINGFUL_SCORE, DEFAULT_AMBIGUOUS_THRESHOLD } from './select-winner.js';
import type { ScoredCandidate } from './types.js';

function makeCandidate(overrides: Partial<ScoredCandidate> & { score: number; url: string }): ScoredCandidate {
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

describe('select-winner — existing behavior', () => {
  it('selects highest scoring candidate, lowConfidence=false', () => {
    const candidates: ScoredCandidate[] = [
      makeCandidate({ score: 100, url: 'a', bitrate: null }),
      makeCandidate({ score: 50, url: 'b', bitrate: null }),
    ];

    const result = selectWinner(candidates);
    expect(result?.winner.score).toBe(100);
    expect(result?.lowConfidence).toBe(false);
    expect(result?.runnerUpScore).toBe(50);
    expect(result?.candidateCount).toBe(2);
  });

  it('tie-breaks by higher bitrate when scores match', () => {
    const candidates: ScoredCandidate[] = [
      makeCandidate({ score: 80, url: 'a', bitrate: 2000000 }),
      makeCandidate({ score: 80, url: 'b', bitrate: 5000000 }),
    ];

    const result = selectWinner(candidates);
    expect(result?.winner.bitrate).toBe(5000000);
  });

  it('tie-breaks by earlier capturedAt when scores and bitrates match', () => {
    const candidates: ScoredCandidate[] = [
      makeCandidate({ score: 80, url: 'a', capturedAt: 2000, bitrate: 2000000 }),
      makeCandidate({ score: 80, url: 'b', capturedAt: 1000, bitrate: 2000000 }),
    ];

    const result = selectWinner(candidates);
    expect(result?.winner.capturedAt).toBe(1000);
  });

  it('sets lowConfidence=true when all candidates are below threshold', () => {
    const candidates: ScoredCandidate[] = [
      makeCandidate({ score: -10, url: 'a' }),
      makeCandidate({ score: -20, url: 'b' }),
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

describe('select-winner — LENS-01 lowConfidence', () => {
  // Test 1: score below minMeaningfulScore → lowConfidence: true
  it('returns lowConfidence:true when winner score is below minMeaningfulScore', () => {
    const result = selectWinner([makeCandidate({ score: 5, url: 'a' })], 10);
    expect(result?.lowConfidence).toBe(true);
  });

  // Test 2: score above minMeaningfulScore → lowConfidence: false
  it('returns lowConfidence:false when winner score is above minMeaningfulScore', () => {
    const result = selectWinner([makeCandidate({ score: 15, url: 'a' })], 10);
    expect(result?.lowConfidence).toBe(false);
  });
});

describe('select-winner — LENS-02 ambiguous detection', () => {
  // Test 3: winner=30, runner-up=15, threshold=20 → ambiguous: true (gap=15 < 20)
  it('returns ambiguous:true when gap between winner and runner-up is less than threshold', () => {
    const candidates = [
      makeCandidate({ score: 30, url: 'winner' }),
      makeCandidate({ score: 15, url: 'runner-up' }),
    ];
    const result = selectWinner(candidates, MIN_MEANINGFUL_SCORE, 20);
    expect(result?.ambiguous).toBe(true);
  });

  // Test 4: winner=50, runner-up=15, threshold=20 → ambiguous: false (gap=35 > 20)
  it('returns ambiguous:false when gap between winner and runner-up exceeds threshold', () => {
    const candidates = [
      makeCandidate({ score: 50, url: 'winner' }),
      makeCandidate({ score: 15, url: 'runner-up' }),
    ];
    const result = selectWinner(candidates, MIN_MEANINGFUL_SCORE, 20);
    expect(result?.ambiguous).toBe(false);
  });

  // Test 5: single candidate → ambiguous: false (no runner-up)
  it('returns ambiguous:false when there is only one candidate', () => {
    const result = selectWinner([makeCandidate({ score: 30, url: 'only' })], MIN_MEANINGFUL_SCORE, 20);
    expect(result?.ambiguous).toBe(false);
  });

  // Test 6: default threshold is 20
  it('uses DEFAULT_AMBIGUOUS_THRESHOLD of 20 when threshold not provided', () => {
    expect(DEFAULT_AMBIGUOUS_THRESHOLD).toBe(20);
    // gap=15 (< 20 default) → ambiguous
    const candidatesAmbiguous = [
      makeCandidate({ score: 30, url: 'winner' }),
      makeCandidate({ score: 15, url: 'runner-up' }),
    ];
    const resultAmbiguous = selectWinner(candidatesAmbiguous);
    expect(resultAmbiguous?.ambiguous).toBe(true);

    // gap=35 (> 20 default) → unambiguous
    const candidatesClear = [
      makeCandidate({ score: 50, url: 'winner' }),
      makeCandidate({ score: 15, url: 'runner-up' }),
    ];
    const resultClear = selectWinner(candidatesClear);
    expect(resultClear?.ambiguous).toBe(false);
  });
});

describe('select-winner — LENS-03 nonWinners exposure', () => {
  // Test 7: 3 candidates → nonWinners contains exactly 2 non-winners in score-DESC order
  it('returns nonWinners array with all non-winners in score-DESC order', () => {
    const candidates = [
      makeCandidate({ score: 10, url: 'third' }),
      makeCandidate({ score: 30, url: 'winner' }),
      makeCandidate({ score: 20, url: 'second' }),
    ];
    const result = selectWinner(candidates);
    expect(result?.nonWinners).toHaveLength(2);
    expect(result?.nonWinners[0].url).toBe('second');
    expect(result?.nonWinners[0].score).toBe(20);
    expect(result?.nonWinners[1].url).toBe('third');
    expect(result?.nonWinners[1].score).toBe(10);
  });

  // Test 8: single candidate → nonWinners is []
  it('returns empty nonWinners array when there is only one candidate', () => {
    const result = selectWinner([makeCandidate({ score: 30, url: 'only' })]);
    expect(result?.nonWinners).toEqual([]);
  });
});

describe('select-winner — combined assertions', () => {
  // Test 9: tie-breaking preserved (higher bitrate wins)
  it('tie-breaking by bitrate still works after ambiguous/nonWinners changes', () => {
    const candidates = [
      makeCandidate({ score: 80, url: 'low-bitrate', bitrate: 1000000 }),
      makeCandidate({ score: 80, url: 'high-bitrate', bitrate: 5000000 }),
    ];
    const result = selectWinner(candidates);
    expect(result?.winner.url).toBe('high-bitrate');
    expect(result?.nonWinners).toHaveLength(1);
    expect(result?.nonWinners[0].url).toBe('low-bitrate');
  });

  // Test 10: confident + uncontested
  it('returns lowConfidence:false, ambiguous:false, nonWinners:[] for single confident candidate', () => {
    const result = selectWinner([makeCandidate({ score: 25, url: 'solo' })]);
    expect(result?.lowConfidence).toBe(false);
    expect(result?.ambiguous).toBe(false);
    expect(result?.nonWinners).toEqual([]);
  });
});
