import type { Page, BrowserContext } from 'patchright';
import { setupInterception } from '../extraction/intercept.js';
import { probeVideoElement, clickLargestVideo, injectVideoElement, extractIframeInfos, clickStreamingSourceButton } from '../extraction/dom-probe.js';
import { scoreCandidate, filterMutedCandidates } from '../scoring/scorer.js';
import { fetchAndParseManifest } from '../scoring/manifest-parser.js';
import { selectWinner, MIN_MEANINGFUL_SCORE } from '../scoring/select-winner.js';
import { deduplicateVariants } from '../scoring/variant-dedup.js';
import { CandidateStore } from '../scoring/candidate-store.js';
import type { Candidate, ScoredCandidate, ManifestInfo, ScoreContext } from '../scoring/types.js';
import type { VideoProbeResult } from '../extraction/dom-probe.js';
import type { AlternativeEntry } from '../types.js';
import { isAdUrl, classifyMedia } from '../extraction/intercept.js';

const EARLY_STOP_THRESHOLD = Number(process.env.EARLY_STOP_THRESHOLD ?? 70);
const MIN_OBSERVATION_MS = Number(process.env.MIN_OBSERVATION_MS ?? 5000);
const MAX_OBSERVATION_MS = Number(process.env.MAX_OBSERVATION_MS ?? 20000);
const NON_AUTOPLAY_WAIT_MS = Number(process.env.NON_AUTOPLAY_WAIT_MS ?? 4000);
const LENS_AMBIGUOUS_THRESHOLD = Number(process.env.LENS_AMBIGUOUS_THRESHOLD ?? 20);
const LENS_MIN_ALTERNATIVE_SCORE = Number(process.env.LENS_MIN_ALTERNATIVE_SCORE ?? 5);

export interface ObservationResult {
  winner: ScoredCandidate;
  lowConfidence: boolean;
  manifest: ManifestInfo | null;
  runnerUpScore: number | null;
  candidateCount: number;
  ambiguous: boolean; // LENS-02: gap between winner and runner-up below threshold
  alternatives: AlternativeEntry[]; // LENS-03: filtered non-winner candidates
}

export interface ObservationOptions {
  context: BrowserContext;
  page: Page;
  abortSignal: AbortSignal;
  navigationStart: number; // Date.now() at page navigation
  pageUrl: string; // The URL Lens navigated to, used for Referer injection on alternatives
  watcherUrls?: string[]; // media URLs discovered by the in-page XHR/Fetch watcher script
}

/**
 * Estimate bitrate from manifest duration and a heuristic.
 * If manifest has segments with byte ranges, compute actual bitrate.
 * Otherwise return null (unknown).
 */
function estimateBitrate(_manifest: ManifestInfo): number | null {
  // For now, return null — actual bitrate comes from master playlist
  // parsing which is a Phase 3 enhancement
  return null;
}

/**
 * Detect post-ad sequences: mark candidates that appeared after another
 * candidate's manifest confirmed EXT-X-ENDLIST.
 * A candidate with ended manifest that appeared before other candidates
 * suggests it was an ad that finished playing.
 */
function detectPostAdSequences(candidates: Candidate[], manifests: Map<string, ManifestInfo | null>): Candidate[] {
  // Find candidates whose manifests are confirmed ended (VOD, not live)
  const endedCandidates = candidates.filter(c => {
    const m = manifests.get(c.url);
    return m && !m.isLive && m.duration < 90; // Short VOD = likely ad
  });

  if (endedCandidates.length === 0) return candidates;

  // The earliest ended candidate's capturedAt is the "ad appeared" time
  const earliestEndedAt = Math.min(...endedCandidates.map(c => c.capturedAt));

  // Mark candidates that appeared AFTER an ended stream
  return candidates.map(c => {
    const isEndedStream = endedCandidates.some(ec => ec.url === c.url);
    if (isEndedStream) return c;

    // If this candidate appeared after a short-VOD candidate
    if (c.capturedAt > earliestEndedAt) {
      return { ...c, precededByEndedStream: true };
    }
    return c;
  });
}

function buildAlternatives(
  nonWinners: ScoredCandidate[],
  manifests: Map<string, ManifestInfo | null>,
  pageUrl: string,
  minScore: number
): AlternativeEntry[] {
  return nonWinners
    .filter(c => c.score >= minScore)
    .map(c => {
      const manifest = manifests.get(c.url) ?? null;
      const headers = { ...c.headers };
      if (!headers['referer'] && !headers['Referer']) {
        headers['referer'] = pageUrl;
      }
      return {
        mediaUrl: c.url,
        mediaType: c.mediaType,
        durationSec: manifest ? manifest.duration : null,
        bitrate: c.bitrate,
        isLive: manifest ? manifest.isLive : undefined,
        headers,
      };
    });
}

export async function runObservationLoop(opts: ObservationOptions): Promise<ObservationResult> {
  const { context, page, abortSignal, navigationStart, pageUrl } = opts;
  const store = new CandidateStore();
  const manifests = new Map<string, ManifestInfo | null>();
  const probeResults = new Map<string, VideoProbeResult>();
  let clickAttempted = false;

  // Start network interception
  const cleanupIntercept = setupInterception({
    context,
    page,
    abortSignal,
    onCandidate: raw => {
      store.add({
        url: raw.url,
        headers: raw.headers,
        mediaType: raw.mediaType,
        capturedAt: raw.capturedAt,
        area: null, // filled by probe
        muted: false, // filled by probe
        precededByEndedStream: false, // filled by ended-stream detection
        bitrate: null, // filled by manifest parsing
      });
    },
  });

  try {
    return await new Promise<ObservationResult>((resolve, reject) => {
      let resolved = false;

      function done(result: ObservationResult) {
        if (resolved) return;
        resolved = true;
        clearInterval(pollInterval);
        clearTimeout(maxTimeout);
        clearTimeout(nonAutoplayTimeout);
        cleanupIntercept();
        resolve(result);
      }

      function fail(err: { code: string; message: string }) {
        if (resolved) return;
        resolved = true;
        clearInterval(pollInterval);
        clearTimeout(maxTimeout);
        clearTimeout(nonAutoplayTimeout);
        cleanupIntercept();
        reject(err);
      }

      // Non-autoplay: if no candidates after NON_AUTOPLAY_WAIT_MS, click
      const nonAutoplayTimeout = setTimeout(async () => {
        if (resolved || clickAttempted) return;
        if (store.count() === 0) {
          clickAttempted = true;
          await clickLargestVideo(page).catch(() => {});
          // 2s after click: if still no candidates, inject a hidden <video> pointing to the
          // page URL. This triggers a video-type request (Accept: video/*) which some proxy
          // endpoints (e.g. Cloudflare Workers) serve video for, even when they return HTML
          // for main-page navigation requests.
          setTimeout(async () => {
            if (resolved || store.count() > 0) return;
            await injectVideoElement(page, pageUrl).catch(() => {});
          }, 2000);
          // 4s after click: if still no candidates, try streaming source buttons
          // (server/embed selectors) then navigate to any video iframe found.
          setTimeout(async () => {
            if (resolved || store.count() > 0) return;
            // Try clicking a streaming source/server button first, then wait for
            // an iframe to appear (some sites inject the player only after a click).
            await clickStreamingSourceButton(page).catch(() => {});
            setTimeout(async () => {
              if (resolved || store.count() > 0) return;
              const iframeInfos = await extractIframeInfos(page).catch(() => [] as { src: string; area: number }[]);
              const iframeUrl = iframeInfos.length > 0
                ? (iframeInfos.find(i => i.area > 40000) ?? iframeInfos[0]).src
                : null;
              if (iframeUrl && iframeUrl !== pageUrl) {
                await page.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
                setTimeout(async () => {
                  if (resolved || store.count() > 0) return;
                  await clickLargestVideo(page).catch(() => {});
                }, 2000);
              }
            }, 1500);
          }, 4000);
        }
      }, NON_AUTOPLAY_WAIT_MS);

      // Hard max timeout
      const maxTimeout = setTimeout(() => {
        evaluateAndFinish();
      }, MAX_OBSERVATION_MS);

      // Abort signal
      abortSignal.addEventListener(
        'abort',
        () => {
          evaluateAndFinish();
        },
        { once: true }
      );

      // Poll every 1000ms to probe, parse manifests, score, check early stop
      const pollInterval = setInterval(async () => {
        if (resolved) return;

        // Drain watcher-discovered URLs (from in-page XHR/Fetch interceptor)
        if (opts.watcherUrls && opts.watcherUrls.length > 0) {
          while (opts.watcherUrls.length > 0) {
            const wu = opts.watcherUrls.shift()!;
            const alreadySeen = store.list().some(c => c.url === wu);
            if (!isAdUrl(wu) && !alreadySeen) {
              store.add({
                url: wu,
                headers: {},
                mediaType: classifyMedia(wu),
                capturedAt: Date.now(),
                area: null,
                muted: false,
                precededByEndedStream: false,
                bitrate: null,
              });
            }
          }
        }

        await probeAndScore();

        const elapsed = Date.now() - navigationStart;
        if (elapsed >= MIN_OBSERVATION_MS) {
          const rawCandidates = store.list();
          if (rawCandidates.length > 0) {
            // Build temporary full candidates for early score check
            const enriched = rawCandidates.map(c => {
              const probe = probeResults.get(c.url) ?? { area: null, muted: false };
              return { ...c, area: probe.area, muted: probe.muted };
            });
            const maxObservedArea = Math.max(0, ...enriched.map(c => c.area ?? 0));
            const ctx: ScoreContext = {
              maxObservedArea,
              navigationStart,
              candidateCount: enriched.length,
            };

            const scored = enriched.map(c => {
              const manifest = manifests.get(c.url) ?? null;
              return { ...c, score: scoreCandidate(c, manifest, ctx) };
            });
            const topScore = Math.max(...scored.map(c => c.score));
            if (topScore >= EARLY_STOP_THRESHOLD) {
              evaluateAndFinish();
            }
          }
        }
      }, 1000);

      async function probeAndScore() {
        const candidates = store.list();
        for (const c of candidates) {
          // Probe DOM for area/muted if not yet probed
          if (!probeResults.has(c.url)) {
            const probe = await probeVideoElement(page, c.url).catch(() => ({ area: null, muted: false }));
            probeResults.set(c.url, probe);
          }
          // Fetch manifest if HLS and not yet fetched
          if (c.mediaType === 'hls' && !manifests.has(c.url)) {
            const manifest = await fetchAndParseManifest(c.url, c.headers).catch(() => null);
            manifests.set(c.url, manifest);
          }
        }
      }

      async function evaluateAndFinish() {
        if (resolved) return;

        const rawCandidates = store.list();
        if (rawCandidates.length === 0) {
          fail({ code: 'no-media-found', message: 'No candidates after observation window' });
          return;
        }

        // Ensure all candidates are probed and manifests fetched
        await probeAndScore();

        // Build full candidates with probe results and manifest signals
        const enriched: Candidate[] = rawCandidates.map(c => {
          const probe = probeResults.get(c.url) ?? { area: null, muted: false };
          const manifest = manifests.get(c.url) ?? null;
          return {
            ...c,
            area: probe.area,
            muted: probe.muted,
            bitrate: manifest ? estimateBitrate(manifest) : c.bitrate,
          };
        });

        // Detect post-ad sequences
        const withPostAd = detectPostAdSequences(enriched, manifests);

        // Pipeline: dedup -> filter muted -> score -> select
        const deduped = deduplicateVariants(withPostAd);
        const filtered = filterMutedCandidates(deduped);

        const maxObservedArea = Math.max(0, ...filtered.map(c => c.area ?? 0));
        const ctx: ScoreContext = {
          maxObservedArea,
          navigationStart,
          candidateCount: filtered.length,
        };

        const scored: ScoredCandidate[] = filtered.map(c => {
          const manifest = manifests.get(c.url) ?? null;
          const score = scoreCandidate(c, manifest, ctx);
          return { ...c, score };
        });

        const result = selectWinner(scored, MIN_MEANINGFUL_SCORE, LENS_AMBIGUOUS_THRESHOLD);
        if (!result) {
          fail({ code: 'no-media-found', message: 'No candidates survived filtering' });
          return;
        }

        const winnerManifest = manifests.get(result.winner.url) ?? null;
        const alternatives = buildAlternatives(result.nonWinners, manifests, pageUrl, LENS_MIN_ALTERNATIVE_SCORE);

        done({
          winner: result.winner,
          lowConfidence: result.lowConfidence,
          manifest: winnerManifest,
          runnerUpScore: result.runnerUpScore,
          candidateCount: result.candidateCount,
          ambiguous: result.ambiguous, // LENS-02
          alternatives, // LENS-03
        });
      }
    });
  } catch (err) {
    cleanupIntercept();
    throw err;
  }
}

// Test-only export — allows unit testing of the pure helper without running the full loop
export { buildAlternatives as _buildAlternatives };


