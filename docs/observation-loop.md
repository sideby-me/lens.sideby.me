# Observation Loop

`src/pipeline/observation-loop.ts` is the core of the capture service. It runs inside the browser context and decides when enough evidence exists to select a winner.

## Timing constants

| Constant | Default | Purpose |
|----------|---------|---------|
| `NON_AUTOPLAY_WAIT_MS` | 4s | Wait before clicking if no candidates detected |
| `MIN_OBSERVATION_MS` | 5s | Minimum polling before scoring starts |
| `MAX_OBSERVATION_MS` | 20s | Hard abort — return best candidate or fail |
| `EARLY_STOP_THRESHOLD` | 70 pts | Exit immediately when top score reaches this |
| Poll interval | 1s | How often to probe + score |

## Phase 1: Setup

1. `setupInterception` registers Playwright network request/response handlers.
   - Filters by media content-type (`.m3u8`, `.mp4`, `video/*`) and URL pattern.
   - Skips ad network domains.
   - Each match calls `onCandidate({ url, headers, mediaType, capturedAt })`.
2. In-page watcher script (injected before navigation) intercepts XHR/Fetch responses and scans JSON payloads for media URLs. Results surface via `window.__lensReportMedia(url)`, exposed through Playwright's `exposeFunction`.
3. Page navigation begins (`waitUntil: domcontentloaded`).

## Phase 2: Poll loop (every 1s)

Each tick:
1. **Drain watcher queue** — collect any URLs the in-page script reported.
2. **Probe unprobed candidates** via `probeVideoElement` (searches all frames for a `<video>` matching the candidate URL):
   - Returns `{ area: width×height, muted }`. Cross-origin frames return `area: null`.
3. **Fetch manifests** — for HLS candidates not yet parsed, call `fetchAndParseManifest`. Detects live vs VOD (re-fetches after 2s if ambiguous), duration, audio track, encryption.
4. **Score** (once `elapsed >= MIN_OBSERVATION_MS`): run `scoreCandidate` for each candidate. If top score `>= EARLY_STOP_THRESHOLD`, exit immediately.

## Phase 3: Non-autoplay intervention

If no candidates after `NON_AUTOPLAY_WAIT_MS` (4s):

1. **Click largest video** — `clickLargestVideo` finds the biggest `<video>` or play button and clicks it.
2. After 2s: **inject synthetic video element** — `injectVideoElement` creates a hidden `<video src="{pageUrl}">` to force a video-type request.
3. After 4s: **click streaming buttons** — `clickStreamingSourceButton` finds buttons matching `/server|source|watch|stream|play|embed|episode/i`. Then navigates to the largest iframe.

## Phase 4: Final evaluation

When `MAX_OBSERVATION_MS` elapses (or early stop triggered):

1. Ensure all remaining candidates are probed and manifests fetched.
2. `deduplicateVariants` — group HLS candidates by base URL, keep highest bitrate per group.
3. `filterMutedCandidates` — remove muted candidates if any non-muted exist.
4. `scoreCandidate` on all remaining.
5. `selectWinner` — sort by score DESC, bitrate DESC, capturedAt ASC.
6. Build `alternatives` list (non-winners with score ≥ 5).
7. Return `ObservationResult`.

## Frame access

`probeVideoElement` iterates all page frames. Cross-origin frame access throws; these are caught and the frame is skipped. If the target video is in a cross-origin iframe, area is `null` — the candidate can still win on other signals.
