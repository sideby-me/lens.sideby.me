# Capture Lifecycle

Full flow from `POST /capture` to SSE `done` event.

## 1. Authentication & validation

`X-Lens-Secret` header checked against `LENS_SHARED_SECRET`. Request body `{ url }` validated as a valid URL. SSE headers set (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`).

## 2. Dedup check (`src/dedup.ts`)

Redis key: `lens:dedup:{SHA256(url)}`

- **Hit**: fetch the cached UUID's KV payload. If `expiresAt > now`, emit `done` immediately with cached data. If stale, delete the dedup key and continue.
- **Miss**: continue to enqueue.

## 3. Job enqueue (`src/queue.ts`)

BullMQ job created with:
- `uuid` — freshly generated
- `url` — the capture target
- `correlation` — W3C `traceparent`, `baggage`, `x-request-id`, `x-dispatch-id`, `x-room-id`, `x-user-id` extracted from request headers

SSE event emitted: `status: queued`

## 4. Worker picks up job

Worker concurrency: `LENS_CONCURRENCY` (default 2). When a slot is free:

SSE event emitted: `status: processing`

## 5. Browser launch (`src/capture.ts`)

patchright Chromium launched with stealth options:
- `--disable-blink-features=AutomationControlled`
- UA spoofed to Chrome 131 on Windows
- UA client hints patched via `addInitScript`
- `window.chrome = { runtime: {} }` injected

## 6. Observation loop (`src/pipeline/observation-loop.ts`)

Network interception registered. In-page XHR/Fetch watcher script injected. Page navigated (`waitUntil: domcontentloaded`). See `observation-loop.md` for full detail.

Returns: winning candidate URL + headers, or throws on timeout.

## 7. Token expiry detection (`src/capture.ts`)

Parses expiry from winner URL params:
- `exp=` or `expires=` (Unix seconds)
- AWS S3: `X-Amz-Date` + `X-Amz-Expires` (relative seconds from date)

`expiresAt` = parsed timestamp or `now + LENS_KV_MAX_TTL_MS` (default 1 hour).

IP-bound detection: if winner URL path matches `/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[:/]/`, sets `ipBound: true`.

## 8. KV write (`src/kv.ts`)

Writes `LensPayload` to Cloudflare KV under key `{uuid}`:

```typescript
{
  mediaUrl, headers, mediaType,
  capturedAt, expiresAt,
  encrypted?, isLive?,
  lowConfidence, ambiguous, alternatives,
  ipBound?
}
```

TTL: `min(expiresAt - now, LENS_KV_MAX_TTL_MS)`, floored at 60 seconds.

## 9. Dedup + UUID bridge write

- Redis: `lens:dedup:{SHA256(url)}` = `uuid`, TTL = `LENS_DEDUP_TTL_S` (default 300s)
- Redis: `uuid-bridge:{uuid}` = W3C correlation record, TTL = 3600s (for pipe telemetry recovery)

## 10. SSE done

```json
{
  "uuid": "...",
  "playbackUrl": "https://pipe.sideby.me?uuid=...",
  "mediaType": "hls",
  "expiresAt": 1234567890000,
  "lowConfidence": false,
  "ambiguous": false,
  "alternatives": []
}
```

Stream closed. `pipe.sideby.me?uuid=<uuid>` reads the KV payload and proxies the stream with the captured auth headers.

## relay/fetch endpoint

`POST /relay/fetch` — used when `ipBound: true`. The captured media URL contains the lens server's egress IP in the path; fetching it from a different IP (pipe's edge node) would fail. `pipe.sideby.me` calls this endpoint and lens makes the upstream fetch from its own IP, returning `{ status, contentType, cacheControl, body }`.
