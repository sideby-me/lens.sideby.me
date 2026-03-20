import type { ScoredCandidate } from './types.js';

export const MIN_MEANINGFUL_SCORE = 10;

export interface WinnerResult {
  winner: ScoredCandidate;
  lowConfidence: boolean;
  runnerUpScore: number | null;  // For Phase 3 logging
  candidateCount: number;         // For Phase 3 logging
}

/**
 * Select the winning candidate from scored candidates.
 *
 * BEHAV-06 Tie-breaking: when scores are equal, pick higher bitrate.
 * If bitrates also equal (or both null), pick earlier capturedAt.
 *
 * BEHAV-07 Low-confidence fallback: if ALL candidates score below
 * minMeaningfulScore, return the best anyway with lowConfidence: true.
 *
 * Returns null if candidates array is empty.
 */
export function selectWinner(
  candidates: ScoredCandidate[],
  minMeaningfulScore: number = MIN_MEANINGFUL_SCORE,
): WinnerResult | null {
  if (candidates.length === 0) return null;

  // Sort by score DESC, then bitrate DESC, then capturedAt ASC
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const bitrateA = a.bitrate ?? 0;
    const bitrateB = b.bitrate ?? 0;
    if (bitrateB !== bitrateA) return bitrateB - bitrateA;
    return a.capturedAt - b.capturedAt;
  });

  const winner = sorted[0];
  const runnerUp = sorted.length > 1 ? sorted[1] : null;

  const lowConfidence = winner.score < minMeaningfulScore;

  return {
    winner,
    lowConfidence,
    runnerUpScore: runnerUp?.score ?? null,
    candidateCount: candidates.length,
  };
}
