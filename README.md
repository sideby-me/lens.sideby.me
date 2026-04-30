# `lens.sideby.me`

A headless browser service that extracts real media URLs from video pages for Sideby.me. Navigates to pages with a stealth Chromium instance, intercepts network traffic, and captures HLS/MP4 streams along with any auth headers required to play them.

## What it does

- Launches a stealth Chromium browser (patchright) to extract media URLs from JS-heavy sites
- Intercepts network requests to detect HLS manifests and MP4 streams
- Captures auth headers alongside media URLs for token-gated content
- Detects token expiry from URL params (`exp=`, `X-Amz-Expires`) and sets matching KV TTL
- Stores payloads in Cloudflare KV with TTL-based expiry
- Streams capture progress back to the caller via SSE
- Deduplicates captures within a configurable window (default 5 min)

## Getting Started

### Prerequisites

- Node.js 18+
- Google Chrome installed (patchright patches it at the binary level)
- Redis (local or Docker: `docker run -d -p 6379:6379 redis`)
- Cloudflare account with a KV namespace

### Environment Setup

Copy `.env.example` to `.env.local`:

```bash
# Server
LENS_PORT=4000
DEPLOYMENT_ENVIRONMENT=development
LENS_SHARED_SECRET=your_shared_secret   # must match sync's LENS_SHARED_SECRET

# Redis (BullMQ job queue + dedup)
REDIS_URL=redis://localhost:6379

# Cloudflare KV (captured payloads)
CF_ACCOUNT_ID=your_account_id
CF_KV_NAMESPACE_ID=your_kv_namespace_id  # use preview_id for local dev
CF_API_TOKEN=your_api_token

# Pipe proxy (playback URLs point here)
PIPE_PROXY_URL=https://pipe.sideby.me   # or http://localhost:8787

# Optional
LENS_CONCURRENCY=2            # parallel browser sessions (default: 2)
LENS_KV_MAX_TTL_MS=3600000    # max payload TTL (default: 1 hour)
LENS_DEDUP_TTL_S=300          # dedup window in seconds (default: 300)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

> **Local dev note:** If running `pipe.sideby.me` with `wrangler dev --remote`, set `CF_KV_NAMESPACE_ID` to the `preview_id` from `pipe.sideby.me/wrangler.toml` so both services share the same KV namespace.

### Running Locally

```bash
npm install
npm run dev       # Hot reload on http://localhost:4000
```

**Test it:**

```bash
# Health check
curl http://localhost:4000/health

# Capture request (SSE stream)
curl -N -X POST http://localhost:4000/capture \
  -H "Content-Type: application/json" \
  -H "X-Lens-Secret: your_shared_secret" \
  -d '{"url": "https://example.com/some-video-page"}'
```

### Available Scripts

```bash
npm run dev        # Start with hot reload (tsx --watch)
npm start          # Production start
npm run build      # TypeScript compile
npm run typecheck  # Type check only
npm run test       # Vitest (verbose)
npm run lint       # ESLint
npm run format     # Prettier format
```

## API

### `POST /capture`

Authenticate with `X-Lens-Secret` header.

**Request:**
```json
{ "url": "https://example.com/video-page" }
```

**Response:** SSE stream with events:

| Event | Payload | Description |
|-------|---------|-------------|
| `status` | `"queued"` | Job enqueued |
| `status` | `"processing"` | Browser running |
| `done` | `{ uuid, playbackUrl, mediaType, expiresAt }` | Success |
| `error` | `{ code, message }` | Failure |

The `playbackUrl` is a `pipe.sideby.me?uuid=<uuid>` URL. `pipe.sideby.me` reads the KV payload by UUID and proxies the stream with the captured headers.

### `GET /_health` / `GET /health`

Health check endpoints.

### `POST /relay/fetch`

Internal endpoint used by `pipe.sideby.me` for IP-bound token relay. Not for external use.

## How It Works

1. `POST /capture` arrives with a URL
2. **Dedup check** — if the same URL was captured recently and the KV payload is still valid, return immediately
3. **Job enqueued** in BullMQ; SSE `status: queued` sent
4. **Browser launched** — stealth Chromium with patched fingerprints (no webdriver signals, spoofed UA client hints)
5. **Network interception** — every request/response inspected for media content types (`.m3u8`, `.mp4`, `.ts`, `video/*`)
6. **HLS found** → resolve immediately; **MP4/other** → wait for page load + settle window
7. **Token expiry** detected from URL params and set as KV TTL
8. **Payload written** to Cloudflare KV: `{ mediaUrl, headers, mediaType, expiresAt }`
9. **SSE `done`** sent with `{ uuid, playbackUrl, mediaType, expiresAt }`
10. `pipe.sideby.me` reads the KV payload by UUID and proxies the stream

## Project Structure

```
src/
├── index.ts            # Express server, /capture SSE endpoint
├── capture.ts          # Capture job orchestration
├── queue.ts            # BullMQ queue + worker setup
├── dedup.ts            # Redis-backed deduplication
├── kv.ts               # Cloudflare KV REST API client
├── sse.ts              # SSE response helpers
├── uuid-bridge.ts      # UUID ↔ KV key mapping
├── redaction.ts        # Credential redaction for logs
├── types.ts            # Shared types
├── extraction/
│   ├── intercept.ts    # Network request interception
│   └── dom-probe.ts    # DOM-level video element detection
├── pipeline/
│   └── observation-loop.ts  # Browser lifecycle + event loop
├── scoring/            # Video candidate scoring + manifest parsing
└── telemetry/          # OTEL setup
```

## Contributing

Open an issue or pull request.
