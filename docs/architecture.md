# Architecture

lens.sideby.me is an Express.js service that launches headless Chromium (via patchright) to extract real media URLs from JavaScript-heavy video pages. It is called by `sync.sideby.me` when the 7-tier dispatch pipeline reaches Tier G.

## Layers

**HTTP server** (`src/index.ts`)
Exposes three endpoints:
- `POST /capture` — authenticated SSE stream; orchestrates capture from request to `done` event
- `POST /relay/fetch` — internal; used by `pipe.sideby.me` to proxy IP-bound stream requests back through lens's egress IP
- `GET /_health` / `GET /health` — health checks

**Job queue** (`src/queue.ts`)
BullMQ backed by Redis. Decouples HTTP requests from browser sessions. Concurrency controlled by `LENS_CONCURRENCY` (default 2). Each job carries a UUID and W3C trace correlation context.

**Capture orchestrator** (`src/capture.ts`)
Launches the patchright browser, runs the observation loop, detects token expiry, writes the winning payload to Cloudflare KV, records the dedup entry, and returns the result to the queue worker.

**Observation loop** (`src/pipeline/observation-loop.ts`)
The core of the service. Sets up network interception, polls the DOM, scores candidates, and decides when to stop. See `observation-loop.md` for details.

**Extraction** (`src/extraction/`)
- `intercept.ts` — registers Playwright network interception and injects an in-page XHR/Fetch watcher script; classifies responses as HLS, MP4, or other
- `dom-probe.ts` — queries video element size/muted state across frames, clicks play buttons, injects synthetic video elements for non-autoplay sites

**Scoring** (`src/scoring/`)
Pure functions: score each candidate, deduplicate HLS variants, select the winner, build the alternatives list. See `scoring.md` for signal details.

**Storage** (`src/kv.ts`, `src/dedup.ts`, `src/uuid-bridge.ts`)
- KV: writes the `LensPayload` to Cloudflare KV with TTL derived from token expiry
- Dedup: Redis key per URL hash; avoids re-capturing the same URL within 5 minutes
- UUID bridge: stores W3C trace correlation keyed by UUID for pipe's telemetry recovery

## Data flow summary

```
POST /capture
  → dedup check (Redis)
  → enqueue BullMQ job (UUID + correlation)
  → SSE: status=queued
  → worker picks up job
  → SSE: status=processing
  → patchright browser launched
  → observation loop (network intercept + DOM probe + scoring)
  → winner selected
  → KV write (LensPayload + TTL)
  → dedup entry written (Redis)
  → SSE: done { uuid, playbackUrl, mediaType, expiresAt, lowConfidence, ambiguous, alternatives }
  → pipe.sideby.me?uuid=<uuid> serves the stream
```
