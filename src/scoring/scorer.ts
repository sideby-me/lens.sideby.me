import type { Candidate, ManifestInfo, ScoreContext } from './types.js';

/** Returns true if the URL path contains '.m3u8' — indicating an HLS playlist/index, not a segment */
function isPlaylistUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().includes('.m3u8');
  } catch {
    return false;
  }
}

/**
 * Score a single candidate. Pure synchronous function — no I/O, no patchright imports.
 * Muted disqualification is NOT handled here — use filterMutedCandidates() before calling.
 *
 * Signal weights:
 *   SIG-01: Area ratio        (0–50 pts)
 *   SIG-03: Capture timing    (+7 or +15 pts)
 *   SIG-04: Short duration    (–30 pts, VOD only)
 *   SIG-05: Long duration     (+20 pts, VOD only)
 *   SIG-06: Audio track       (+10 pts)
 *   SIG-07: Post-ad sequence  (+25 pts)
 *   SIG-08: HLS playlist URL  (+20 pts — M3U8 index preferred over .ts segment)
 */
export function scoreCandidate(
  candidate: Candidate,
  manifest: ManifestInfo | null,
  ctx: ScoreContext
): number {
  let score = 0;

  // SIG-01: Area (up to 50 points)
  if (candidate.area != null && ctx.maxObservedArea > 0) {
    score += (candidate.area / ctx.maxObservedArea) * 50;
  }

  // SIG-03: Capture timing
  const elapsed = candidate.capturedAt - ctx.navigationStart;
  if (elapsed > 3000) score += 15;
  else if (elapsed > 1500) score += 7;

  // SIG-04 + SIG-05: Duration scoring (skip for live streams)
  if (manifest && !manifest.isLive) {
    if (manifest.duration < 90) score -= 30;
    else if (manifest.duration > 180) score += 20;
  }

  // SIG-06: Audio track
  if (manifest?.hasAudioTrack) score += 10;

  // SIG-07: Post-ad sequence
  if (candidate.precededByEndedStream) score += 25;

  // SIG-08: HLS playlist type — prefer M3U8 index/playlist URLs over raw .ts segments
  // A .ts segment URL indicates a single media segment; the player needs the M3U8 index.
  if (candidate.mediaType === 'hls') {
    if (isPlaylistUrl(candidate.url)) {
      score += 20;
    }
  }

  return score;
}

/**
 * SIG-02: Filter out muted candidates when non-muted candidates exist.
 * If ALL candidates are muted, return them all (allow muted when only option).
 */
export function filterMutedCandidates(candidates: Candidate[]): Candidate[] {
  if (candidates.length === 0) return [];
  const nonMuted = candidates.filter(c => !c.muted);
  return nonMuted.length > 0 ? nonMuted : candidates;
}
