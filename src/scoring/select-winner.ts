import type { ScoredCandidate } from './types.js';

export const MIN_MEANINGFUL_SCORE = 10;
export const DEFAULT_AMBIGUOUS_THRESHOLD = 20;

export interface WinnerResult {
  winner: ScoredCandidate;
  lowConfidence: boolean;
  runnerUpScore: number | null;  // For Phase 3 logging
  candidateCount: number;         // For Phase 3 logging
  ambiguous: boolean;             // LENS-02: gap < ambiguousThreshold
  nonWinners: ScoredCandidate[];  // LENS-03: sorted score-DESC, winner excluded
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
 * LENS-02 Ambiguous detection: if the gap between winner and runner-up
 * is less than ambiguousThreshold, mark ambiguous: true.
 *
 * LENS-03 Non-winner exposure: all non-winning candidates in score-DESC
 * order are returned in nonWinners.
 *
 * Returns null if candidates array is empty.
 */
export function selectWinner(
  candidates: ScoredCandidate[],
  minMeaningfulScore: number = MIN_MEANINGFUL_SCORE,
  ambiguousThreshold: number = DEFAULT_AMBIGUOUS_THRESHOLD,
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
  const ambiguous = runnerUp !== null
    ? (winner.score - runnerUp.score) < ambiguousThreshold
    : false;
  const nonWinners = sorted.slice(1);  // everything after winner, already score-DESC

  return {
    winner,
    lowConfidence,
    runnerUpScore: runnerUp?.score ?? null,
    candidateCount: candidates.length,
    ambiguous,
    nonWinners,
  };
}
