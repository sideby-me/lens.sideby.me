# Architecture

lens.sideby.me is an Express.js service that launches headless Chromium (via patchright) to extract real media URLs from JavaScript-heavy video pages. It is called by `sync.sideby.me` when the 7-tier dispatch pipeline reaches Tier G.

## Layers

**HTTP server** (`src/index.ts`)
Exposes three endpoints:
- `POST /capture` — authenticated SSE stream; rate-limit check (via `src/rate-limiter.ts`) fires before SSE headers are sent; returns HTTP 429 with `retryAfterMs` if the per-room/user limit is exceeded; otherwise orchestrates capture from request to `done` event
- `POST /relay/fetch` — internal; used by `pipe.sideby.me` to proxy IP-bound stream requests back through lens's egress IP
- `GET /_health` / `GET /health` — health checks

**Rate limiter** (`src/rate-limiter.ts`)
Fixed-window Redis counter keyed by room ID → user ID → global. Configured by `LENS_RATE_LIMIT_MAX` (default 3) and `LENS_RATE_LIMIT_WINDOW_MS` (default 60 s). Implemented as an atomic Lua script (`incrAndExpire`) registered via `defineCommand`. Fails open on Redis error.

**Proxy pool** (`src/proxy-pool.ts`)
Round-robin selection from a comma-separated SOCKS5/HTTP proxy list in `LENS_PROXY_POOL`. `getNextProxy()` returns the next proxy string or `null` when the env var is unset. `capture.ts` passes the selected proxy to `chromium.launch({ proxy: { server } })` per job and stores it in `LensPayload.proxyServer`.

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
  → rate limit check (Redis fixed-window; 429 if exceeded)
  → dedup check (Redis)
  → enqueue BullMQ job (UUID + correlation)
  → SSE: status=queued
  → worker picks up job
  → proxy selected (getNextProxy() — round-robin from LENS_PROXY_POOL, or null)
  → SSE: status=processing
  → patchright browser launched (with proxy if selected)
  → observation loop (network intercept + DOM probe + scoring)
  → winner selected
  → KV write (LensPayload + TTL; proxyServer stored if proxy active)
  → dedup entry written (Redis)
  → SSE: done { uuid, playbackUrl, mediaType, expiresAt, lowConfidence, ambiguous, alternatives }
  → pipe.sideby.me?uuid=<uuid> serves the stream
```
