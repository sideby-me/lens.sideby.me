# Local Development

## Prerequisites

- Node.js 18+
- Google Chrome installed (patchright patches it at the binary level)
- Redis: `docker run -d -p 6379:6379 redis`
- Cloudflare account with a KV namespace (use `preview_id` from `pipe.sideby.me/wrangler.toml` for local dev)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local`:
   ```bash
   LENS_PORT=4000
   DEPLOYMENT_ENVIRONMENT=development
   LENS_SHARED_SECRET=dev_secret
   LENS_CONCURRENCY=2
   REDIS_URL=redis://localhost:6379
   PIPE_PROXY_URL=http://localhost:8787
   CF_ACCOUNT_ID=your_account_id
   CF_KV_NAMESPACE_ID=your_preview_kv_id
   CF_API_TOKEN=your_api_token
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # optional
   ```

> **KV tip**: For local dev, set `CF_KV_NAMESPACE_ID` to the `preview_id` from `pipe.sideby.me/wrangler.toml` so both services share the same KV namespace.

## Running

```bash
npm run dev       # Hot reload on http://localhost:4000
```

## Testing

```bash
# Health check
curl http://localhost:4000/health

# Capture (SSE stream)
curl -N -X POST http://localhost:4000/capture \
  -H "Content-Type: application/json" \
  -H "X-Lens-Secret: dev_secret" \
  -d '{"url": "https://example.com/video-page"}'
```

Expect SSE events: `status: queued` → `status: processing` → `done: {...}` (or `error: {...}`).

## Available scripts

```bash
npm run dev        # Hot reload (tsx --watch)
npm start          # Production
npm run build      # TypeScript compile
npm run typecheck  # Type check only
npm run test       # Vitest (verbose)
npm run lint       # ESLint
npm run format     # Prettier
```

## Running a single test

```bash
npm test -- intercept          # matches src/extraction/intercept.test.ts
npm test -- --reporter=verbose dom-probe
```
