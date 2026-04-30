# Logging and Observability

## Structured logging (`src/telemetry/logs.ts`)

Use `logInfo`, `logWarn`, `logError` — never `console.log` directly:

```typescript
logInfo('Capture started', {
  domain: 'capture',
  event: 'capture_started',
  request_id: '...',
  dispatch_id: '...',
  meta: { url: redactedUrl },
});
```

Each call emits a JSON line to stdout **and** to the OTel logs API (if configured):

```json
{
  "level": "info",
  "service": "lens",
  "domain": "capture",
  "event": "capture_started",
  "message": "Capture started",
  "ts": 1234567890000,
  "request_id": "...",
  "dispatch_id": "...",
  "trace_id": "...",
  "span_id": "...",
  "room_id": null,
  "user_id": null,
  "meta": { ... }
}
```

**Redaction** (`src/redaction.ts`): before any payload is logged or emitted to OTel, `redactSensitive` strips keys matching `email`, `message`, `text`, `ip`, `ip_address`. Replaced with `'[REDACTED]'`. Never log raw URLs that contain auth tokens — use the redacted form.

## Metrics (`src/telemetry/metrics.ts`)

Golden signals recorded on every capture:

| Metric | Type | Attributes |
|--------|------|------------|
| `capture_requests_total` | Counter | `media_type`, `outcome` (`success`\|`failure`\|`timeout`) |
| `capture_latency_ms` | Histogram | `media_type`, `outcome` |
| `capture_errors_total` | Counter | `media_type`, `error_type` |

Queue depth gauges (`src/queue-metrics.ts`, polled every 5 min):

| Metric | Description |
|--------|-------------|
| `queue_depth_waiting` | Jobs waiting for a free worker |
| `queue_depth_active` | Jobs currently running |
| `queue_depth_failed` | Jobs that failed permanently |
| `queue_wait_age_seconds` | Age of the oldest waiting job |

All metric recording is wrapped in try/catch — errors are logged as warnings and never propagate.

## OTEL trace propagation (`src/telemetry/queue-correlation.ts`)

W3C `traceparent` from the inbound `POST /capture` request is extracted and stored in the BullMQ job payload. When the worker processes the job, `startQueueChildSpan()` creates a child span under the original trace. This means the browser capture, KV write, and dedup operations all appear as children of the `sync.sideby.me` dispatch span in your trace backend.

The UUID bridge (`src/uuid-bridge.ts`) stores the correlation record in Redis (TTL 1 hour) so `pipe.sideby.me` can recover the trace context when serving the stream.

## Configuration

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # required to enable telemetry
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer ... # optional auth (CSV key=value)
OTEL_SERVICE_NAME=lens.sideby.me                    # default
```

If `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, telemetry is disabled and the service runs without it (fail-open).
