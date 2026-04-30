# File Structure

```
src/
├── index.ts                    # Express server, /capture SSE, /relay/fetch, health
├── capture.ts                  # Capture orchestrator: browser → observation → KV write
├── queue.ts                    # BullMQ queue + worker setup, job correlation
├── queue-metrics.ts            # Observable gauges: queue depth + wait-age
├── dedup.ts                    # Redis-backed URL deduplication
├── kv.ts                       # Cloudflare KV REST API client (read/write/delete)
├── sse.ts                      # SSE write/flush/close helpers
├── uuid-bridge.ts              # UUID → W3C trace correlation stored in Redis
├── redaction.ts                # Strips PII from log/telemetry payloads
├── types.ts                    # Shared types: LensPayload, AlternativeEntry, etc.
│
├── extraction/
│   ├── intercept.ts            # Network interception + in-page XHR/Fetch watcher script
│   └── dom-probe.ts            # Video element probing, iframe extraction, click helpers
│
├── pipeline/
│   └── observation-loop.ts     # Main event loop: intercept → probe → manifest → score → stop
│
├── scoring/
│   ├── types.ts                # Candidate, ManifestInfo, ScoreContext, WinnerResult types
│   ├── candidate-store.ts      # In-memory candidate list (mutable during loop)
│   ├── scorer.ts               # scoreCandidate() — pure, 8 signals
│   ├── select-winner.ts        # selectWinner() — sort, confidence + ambiguity flags
│   ├── manifest-parser.ts      # fetchAndParseManifest() — live/VOD, duration, audio, encryption
│   └── variant-dedup.ts        # deduplicateVariants() — group by base URL, keep highest bitrate
│
└── telemetry/
    ├── bootstrap.ts            # OTel SDK init (traces, metrics, logs)
    ├── logs.ts                 # logInfo/logWarn/logError — JSON stdout + OTel log emission
    ├── metrics.ts              # Golden signal instruments: requests, latency, errors
    └── queue-correlation.ts    # Trace context propagation through BullMQ job payloads
```
