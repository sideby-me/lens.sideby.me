# `Sideby Lens`

A headless browser service that extracts real media URLs from video pages for Sideby.me. Navigates to pages with a stealth Chromium instance, intercepts network traffic, and captures HLS/MP4 streams that can't be proxied directly.

## What it does

TL;DR:

- Launches a stealth Chromium browser (via patchright) to extract media URLs from JS-heavy sites
- Intercepts network requests to detect HLS manifests and MP4 streams
- Captures auth headers alongside media URLs for token-gated content
- Stores payloads in Cloudflare KV with TTL-based expiry
- Streams progress back to the caller via SSE
- Deduplicates captures within a 5-minute window

## Getting Started

### Prerequisites

- [`Node.js 18+`](https://nodejs.org/en)
- [`Google Chrome`](https://www.google.com/chrome/) installed (patchright patches it at the binary level)
- [`Docker`](https://www.docker.com/) for Redis (used for job queue + dedup)
- A Cloudflare account with a KV namespace

### Environment Setup

Create a `.env.local` file:

```bash
# Server
LENS_PORT=4000
LENS_SHARED_SECRET=your_shared_secret   # must match pipe's LENS_SHARED_SECRET

# Redis (for BullMQ job queue + dedup)
REDIS_URL=redis://localhost:6379

# Cloudflare KV (where captured payloads are stored)
CF_ACCOUNT_ID=your_account_id
CF_KV_NAMESPACE_ID=your_kv_namespace_id  # use preview_id for local dev
CF_API_TOKEN=your_api_token

# Pipe proxy (where playback URLs point to)
PIPE_PROXY_URL=https://pipe.sideby.me   # or http://localhost:8787 for local dev

# Optional
LENS_CONCURRENCY=2        # number of parallel browser sessions
LENS_KV_MAX_TTL_MS=3600000  # max payload TTL (default: 1 hour)
```

> **Local dev note:** If running `pipe.sideby.me` with `wrangler dev --remote`, set `CF_KV_NAMESPACE_ID` to the `preview_id` from `pipe.sideby.me/wrangler.toml` so both services share the same KV namespace.

### Running it Locally

**1. Install dependencies**

```bash
npm install
```

**2. Start Redis**

```bash
docker run -d -p 6379:6379 redis
```

**3. Start the dev server**

```bash
npm run dev
```

This starts the service on `http://localhost:4000`.

**4. Test it**

```bash
# Health check
curl http://localhost:4000/health

# Capture request (returns SSE stream)
curl -N -X POST http://localhost:4000/capture \
  -H "Content-Type: application/json" \
  -H "X-Lens-Secret: your_shared_secret" \
  -d '{"url": "https://vimeo.com/123456789"}'
```

### Available Scripts

```bash
npm run dev        # Start with hot reload (tsx --watch)
npm run start      # Production start
npm run build      # TypeScript compile
npm run typecheck  # Type check without emitting
npm run lint       # ESLint
npm run format     # Prettier format
```

## How It Works

1. **Request comes in** via `POST /capture` with `{ url }` in the body
2. **Dedup check** — if the same URL was captured within the last 5 minutes and the KV payload is still valid, return immediately
3. **Job enqueued** into BullMQ; SSE `status: queued` sent to caller
4. **Browser launches** — stealth Chromium with patched fingerprints (no webdriver signals, spoofed UA client hints)
5. **Network interception** — every request/response is inspected for media content types (`.m3u8`, `.mp4`, `.ts`, `video/*`)
6. **HLS found** → resolve immediately; **MP4/other** → wait for page load + 3s settle window
7. **Token expiry** detected from URL params (`exp=`, `X-Amz-Expires`) and stored as KV TTL
8. **Payload written** to Cloudflare KV: `{ mediaUrl, headers, mediaType, expiresAt }`
9. **SSE `done` event** sent with `{ uuid, playbackUrl, mediaType, expiresAt }`
10. **pipe.sideby.me** reads the KV payload by UUID and proxies the stream with the captured headers

## Contributing

If you find ways to make improvements (or find bugs), feel free to open an issue or a pull request :/
