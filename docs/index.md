# lens.sideby.me Documentation

This directory documents how the lens.sideby.me headless capture service is structured and how to work on it.

## Contents

- `architecture.md` — Service overview, layers, and how capture flows end to end
- `file-structure.md` — Directory layout and what lives where
- `local-development.md` — Running the service locally
- `contributing.md` — Where to put new code and patterns to follow
- `capture-lifecycle.md` — Full lifecycle: POST /capture → browser → KV → SSE done
- `observation-loop.md` — How the browser observation loop works, timing, DOM interaction
- `scoring.md` — Candidate scoring signals, winner selection, KV payload shape
- `logging-and-observability.md` — Structured logging, metrics, OTEL trace propagation
