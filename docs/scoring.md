# Scoring

Scoring determines which detected media stream is the main content on the page.

## Scoring signals (`src/scoring/scorer.ts`)

`scoreCandidate(candidate, manifestInfo, context)` is a pure function. It returns a numeric score:

| Signal | Points | Condition |
|--------|--------|-----------|
| SIG-01 | 0–50 | **Area ratio**: `(candidateArea / maxObservedArea) × 50`. Largest video on page scores 50; unprobed/cross-origin scores 0. |
| SIG-02 | filter | **Muted**: candidates are filtered out before scoring if non-muted alternatives exist. |
| SIG-03 | 0–15 | **Timing**: +15 if captured >3s after navigation; +7 if >1.5s. Rewards streams that load after the page, not before. |
| SIG-04 | −30 | **Short VOD**: duration <90s. Likely an ad or preview clip. |
| SIG-05 | +20 | **Long VOD**: duration >180s. Likely main content. |
| SIG-06 | +10 | **Audio track**: `#EXT-X-MEDIA TYPE=AUDIO` present in manifest. |
| SIG-07 | +25 | **Post-ad sequence**: another candidate's manifest ended (`#EXT-X-ENDLIST`) before this one was captured. Suggests this is the real content after an ad. |
| SIG-08 | +20 | **HLS playlist URL**: `.m3u8` in the URL. Prefers playlist entries over raw `.ts` segments. |

Maximum score: ~140+ points. `EARLY_STOP_THRESHOLD` is 70 — a candidate with a large area, good timing, and long duration will typically exceed this.

## Winner selection (`src/scoring/select-winner.ts`)

Sort order: score DESC → bitrate DESC → capturedAt ASC (earliest wins ties).

Three flags set on the result:

**`lowConfidence`** (LENS-01): winner score < 10. The service captured something but has very low confidence it's the right stream. The client should surface the picker UI.

**`ambiguous`** (LENS-02): winner score − runner-up score < 20. Multiple streams scored similarly. The client should surface the picker UI.

**`alternatives`** (LENS-03): non-winning candidates with score ≥ 5, sorted by score DESC. Stored in the KV payload so the client can offer them if the primary fails.

## Variant deduplication (`src/scoring/variant-dedup.ts`)

HLS master playlists often spawn multiple variant candidates (720p, 1080p, etc.) that differ only in the last path segment. These are grouped by base URL (path minus last segment). The highest-bitrate variant from each group is kept; others are dropped before scoring.

## Manifest parsing (`src/scoring/manifest-parser.ts`)

For each HLS candidate, `fetchAndParseManifest` fetches the playlist and returns `ManifestInfo`:

```typescript
{
  isLive: boolean       // true if live stream, false if VOD
  duration: number      // sum of segment durations (seconds)
  hasAudioTrack: boolean
  encrypted: boolean    // #EXT-X-KEY METHOD != NONE
}
```

Live detection logic:
1. Check `#EXT-X-PLAYLIST-TYPE`: `EVENT` or `LIVE` → live; `VOD` → not live.
2. If missing: check `#EXT-X-ENDLIST` presence → not live; absence → ambiguous.
3. If ambiguous: re-fetch after `LIVE_RECHECK_MS` (2s). If new segments appeared → live.

## KV payload shape (`src/types.ts`)

What gets stored in Cloudflare KV per UUID:

```typescript
{
  mediaUrl: string                    // winning stream URL
  headers: Record<string, string>     // auth headers (Bearer, Cookie, etc.)
  mediaType: 'hls' | 'mp4' | 'other'
  capturedAt: number                  // Unix ms
  expiresAt: number                   // Unix ms — used for KV TTL and dedup stale check
  encrypted?: boolean
  isLive?: boolean
  lowConfidence: boolean
  ambiguous: boolean
  alternatives: AlternativeEntry[]
  ipBound?: boolean                   // true → pipe must route via /relay/fetch
}

interface AlternativeEntry {
  mediaUrl: string
  mediaType: 'hls' | 'mp4' | 'other'
  durationSec: number | null
  bitrate: number | null
  isLive: boolean | undefined
  headers: Record<string, string>
}
```
