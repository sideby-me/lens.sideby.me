# Contributing to lens.sideby.me

## Before you start

- Run the service locally (see `local-development.md`).
- Skim the architecture, capture lifecycle, and observation loop docs.

## Where to put things

- **HTTP endpoint changes**: `src/index.ts`
- **Browser launch or capture orchestration**: `src/capture.ts`
- **Network interception or in-page watcher script**: `src/extraction/intercept.ts`
- **DOM probing, click helpers, iframe navigation**: `src/extraction/dom-probe.ts`
- **Observation loop timing, early-stop logic**: `src/pipeline/observation-loop.ts`
- **Scoring signals** (pure functions, no I/O): `src/scoring/scorer.ts`
- **Winner selection, confidence/ambiguity flags**: `src/scoring/select-winner.ts`
- **Manifest fetching/live detection**: `src/scoring/manifest-parser.ts`
- **KV read/write**: `src/kv.ts`
- **Dedup logic**: `src/dedup.ts`
- **Queue configuration**: `src/queue.ts`

## Key invariants

- **Scoring is pure**: `scoreCandidate`, `selectWinner`, `deduplicateVariants`, and `filterMutedCandidates` must remain pure functions with no I/O or side effects. Tests depend on this.
- **Fail-open telemetry**: all telemetry and metric operations are wrapped in try/catch and never throw. Do not break this.
- **Token expiry drives TTL**: the KV `expiresAt` and TTL must accurately reflect the stream's actual auth token expiry, not a fixed duration.
- **IP-bound detection**: if a media URL contains an IP address in the path, set `ipBound: true` in the KV payload so `pipe.sideby.me` routes via `/relay/fetch`.

## Adding a new scoring signal

1. Add a constant and description comment in `src/scoring/scorer.ts`.
2. Update `scoreCandidate()` to compute and apply the new signal.
3. Document it in `scoring.md`.
4. Add unit tests in `src/scoring/__tests__/` or alongside the file.

## Submitting changes

- Keep pull requests focused on a single concern.
- Update the relevant doc in this folder when adding new behavior.
- Run `npm run typecheck` and `npm run test` before submitting.
