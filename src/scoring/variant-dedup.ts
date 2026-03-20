import type { Candidate } from './types.js';

/**
 * BEHAV-04: Deduplicate multi-quality variant streams that share the same master M3U8.
 *
 * HLS variant playlists have URLs like:
 *   master.m3u8 -> 720p/stream.m3u8, 1080p/stream.m3u8
 *
 * Grouping strategy: extract the "base URL" by removing the last path segment
 * (the variant-specific part). Candidates with the same base URL and same host
 * are considered variants of the same stream.
 *
 * From each group, select the candidate with the highest bitrate.
 * If bitrates are equal or null, select the earliest-captured.
 */
export function deduplicateVariants(candidates: Candidate[]): Candidate[] {
  if (candidates.length <= 1) return candidates;

  const hlsCandidates = candidates.filter(c => c.mediaType === 'hls');
  const nonHls = candidates.filter(c => c.mediaType !== 'hls');

  // Group HLS candidates by base URL
  const groups = new Map<string, Candidate[]>();
  for (const c of hlsCandidates) {
    const base = extractBaseUrl(c.url);
    const existing = groups.get(base) ?? [];
    existing.push(c);
    groups.set(base, existing);
  }

  // Select best from each group
  const deduped: Candidate[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      deduped.push(group[0]);
    } else {
      // Pick highest bitrate; if tied, earliest captured
      group.sort((a, b) => {
        const bitrateA = a.bitrate ?? 0;
        const bitrateB = b.bitrate ?? 0;
        if (bitrateB !== bitrateA) return bitrateB - bitrateA;
        return a.capturedAt - b.capturedAt;
      });
      deduped.push(group[0]);
    }
  }

  return [...deduped, ...nonHls];
}

/**
 * Extract a base URL by removing the last path segment.
 * "https://cdn.example.com/master.m3u8/720p/stream.m3u8" -> "https://cdn.example.com/master.m3u8/720p"
 * For URLs with query params, strip params first for grouping.
 */
function extractBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length > 1) {
      pathParts.pop(); // Remove last segment (variant-specific)
    }
    return `${parsed.origin}/${pathParts.join('/')}`;
  } catch {
    return url; // Ungroupable
  }
}
