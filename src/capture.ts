import { chromium } from 'patchright';
import { getNextProxy } from './proxy-pool.js';
import { WATCHER_SCRIPT } from './extraction/intercept.js';
import { v4 as uuidv4 } from 'uuid';
import { context, trace } from '@opentelemetry/api';
import { runObservationLoop } from './pipeline/observation-loop.js';
import { putKV } from './kv.js';
import { dedupSet } from './dedup.js';
import { buildCorrelationFields, redactTelemetryPayload } from './redaction.js';
import { logError, logInfo, logWarn } from './telemetry/logs.js';
import { recordCaptureLatency, recordCaptureOutcome, recordCaptureError } from './telemetry/metrics.js';
import type { CaptureResult, LensPayload, TelemetryCorrelation } from './types.js';
import { detectExpiry } from './extraction/expiry.js';
import { tryYtdlp } from './extraction/ytdlp.js';

const CAPTURE_TIMEOUT_MS = 30_000;

export function applyActiveSpanCorrelation(correlation: TelemetryCorrelation = {}): TelemetryCorrelation {
  const activeSpanContext = trace.getSpan(context.active())?.spanContext();
  if (!activeSpanContext) {
    return correlation;
  }

  return {
    ...correlation,
    traceId: activeSpanContext.traceId || correlation.traceId,
    spanId: activeSpanContext.spanId || correlation.spanId,
  };
}

export function buildCaptureTelemetryPayload(
  event: string,
  correlation: TelemetryCorrelation = {},
  payload: Record<string, unknown> = {}
): Record<string, unknown> {
  return redactTelemetryPayload({
    event,
    ...buildCorrelationFields(correlation),
    ...payload,
  });
}

function logCaptureTelemetry(
  level: 'info' | 'warn' | 'error',
  event: string,
  correlation: TelemetryCorrelation = {},
  payload: Record<string, unknown> = {}
): void {
  const line = JSON.stringify(buildCaptureTelemetryPayload(event, correlation, payload));
  if (level === 'error') {
    logError(line);
    return;
  }
  if (level === 'warn') {
    logWarn(line);
    return;
  }
  logInfo(line);
}

// Private helper — defined inside capture.ts module scope (not exported)
async function finishCapture(
  uuid: string,
  payload: LensPayload,
  captureMethod: 'ytdlp' | 'chromium',
  correlation: TelemetryCorrelation,
  startTime: number,
  originalUrl: string // page URL for dedupSet — NOT payload.mediaUrl (see Pitfall 1)
): Promise<void> {
  await putKV(uuid, payload, payload.expiresAt);
  await dedupSet(originalUrl, uuid);
  logCaptureTelemetry('info', 'capture_completed', correlation, {
    uuid,
    mediaType: payload.mediaType,
    captureMethod, // TELE-02: new field
    lowConfidence: payload.lowConfidence,
    ambiguous: payload.ambiguous,
  });
  recordCaptureLatency(payload.mediaType, 'success', Date.now() - startTime);
  recordCaptureOutcome(payload.mediaType, 'success');
}

// Capture media URL + headers from the given page URL, with a timeout and ad filtering
export async function capture(url: string, correlation: TelemetryCorrelation = {}): Promise<CaptureResult> {
  const captureStartTime = Date.now();
  const runtimeCorrelation = applyActiveSpanCorrelation(correlation);
  const uuid = uuidv4();
  const abortController = new AbortController();

  logCaptureTelemetry('info', 'capture_started', runtimeCorrelation, {
    url,
  });

  // Hard abort at CAPTURE_TIMEOUT_MS
  const timeout = setTimeout(() => abortController.abort(), CAPTURE_TIMEOUT_MS);

  const proxyServer = getNextProxy();
  if (proxyServer) {
    logInfo('Using proxy for capture', { domain: 'capture', event: 'capture_proxy_selected', proxy: proxyServer });
  }

  // PROC-05: yt-dlp timeout default 8s leaves 22s for Chromium within CAPTURE_TIMEOUT_MS (30s)
  const ytdlpResult = await tryYtdlp(url, runtimeCorrelation, abortController.signal);
  if (ytdlpResult) {
    const maxTtlMs = Number(process.env.LENS_KV_MAX_TTL_MS ?? 3_600_000);
    const now = Date.now();
    const payload: LensPayload = {
      mediaUrl: ytdlpResult.mediaUrl,
      headers: {},
      mediaType: ytdlpResult.mediaType,
      capturedAt: now,
      expiresAt: detectExpiry(ytdlpResult.mediaUrl) ?? now + maxTtlMs,
      isLive: ytdlpResult.isLive,
      lowConfidence: false,
      ambiguous: false,
      alternatives: [],
      // ipBound and proxyServer intentionally omitted for yt-dlp hits (D-06)
    };
    await finishCapture(uuid, payload, 'ytdlp', runtimeCorrelation, captureStartTime, url);
    clearTimeout(timeout);
    return { uuid, payload };
  }

  let browser;
  try {
    // Launch patchright's chromium - patches WebDriver fingerprints at binary level
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-first-run',
        '--no-default-browser-check',
        '--use-gl=angle',
        '--use-angle=gl',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    // Context with UA + UA Client Hints alignment
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': '"Windows"',
      },
    });

    // patchright handles webdriver/plugins - only these remain:
    await context.addInitScript(() => {
      // patchright does NOT cover window.chrome
      const windowWithChrome = window as unknown as { chrome?: { runtime: Record<string, unknown> } };
      windowWithChrome.chrome = { runtime: {} };

      // Spoof userAgentData to match the chosen UA string
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands: [
            { brand: 'Google Chrome', version: '131' },
            { brand: 'Chromium', version: '131' },
            { brand: 'Not_A Brand', version: '24' },
          ],
          mobile: false,
          platform: 'Windows',
          getHighEntropyValues: (_hints: string[]) =>
            Promise.resolve({
              platform: 'Windows',
              platformVersion: '15.0.0',
              architecture: 'x86',
              bitness: '64',
              fullVersionList: [
                { brand: 'Google Chrome', version: '131.0.0.0' },
                { brand: 'Chromium', version: '131.0.0.0' },
                { brand: 'Not_A Brand', version: '24.0.0.0' },
              ],
            }),
        }),
      });
    });

    // Create page first so we can pass it to setupInterception for load+settle
    const page = await context.newPage();

    // Expose callback for the watcher script, then inject it before navigation.
    const watcherUrls: string[] = [];
    await page.exposeFunction('__lensReportMedia', (url: string) => {
      watcherUrls.push(url);
    });
    await context.addInitScript(WATCHER_SCRIPT);

    // Navigate
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: CAPTURE_TIMEOUT_MS,
    });

    const navigationStart = Date.now();

    // Run the observation pipeline
    const result = await runObservationLoop({
      context,
      page,
      abortSignal: abortController.signal,
      navigationStart,
      pageUrl: url,
      watcherUrls,
    });

    logInfo('Captured media candidate', {
      domain: 'capture',
      event: 'capture_winner_selected',
      url: result.winner.url,
      score: result.winner.score,
      runnerUpScore: result.runnerUpScore ?? null,
      candidateCount: result.candidateCount,
    });

    if (result.lowConfidence) {
      logWarn('Low confidence capture result', {
        domain: 'capture',
        event: 'capture_low_confidence',
        url,
        bestScore: result.winner.score,
        candidateCount: result.candidateCount,
      });
    }

    // Detect IP-bound token: some CDNs embed the capture IP in the path and reject
    // requests from any other IP. Pipe detects this flag and routes through the home relay.
    const IP_IN_PATH = /\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[:/]/;
    const ipBound = IP_IN_PATH.test(result.winner.url);

    // Ensure Referer is present — some pages suppress it via referrer policy,
    // but the upstream CDN may need it for hotlink validation.
    const winnerHeaders = { ...result.winner.headers };
    if (!winnerHeaders['referer'] && !winnerHeaders['Referer']) {
      winnerHeaders['referer'] = url;
    }

    // Detect expiry from the captured URL
    const maxTtlMs = Number(process.env.LENS_KV_MAX_TTL_MS ?? 3_600_000);
    const now = Date.now();
    const tokenExpiry = detectExpiry(result.winner.url);
    const expiresAt = tokenExpiry ?? now + maxTtlMs;

    // Build payload
    const payload: LensPayload = {
      mediaUrl: result.winner.url,
      headers: winnerHeaders,
      mediaType: result.winner.mediaType,
      capturedAt: now,
      expiresAt,
      encrypted: result.manifest?.encrypted ?? undefined,
      isLive: result.manifest?.isLive ?? undefined,
      lowConfidence: result.lowConfidence, // LENS-01
      ambiguous: result.ambiguous, // LENS-02
      alternatives: result.alternatives, // LENS-03
      ipBound: ipBound || undefined, // omit false to keep payload lean
      proxyServer: proxyServer ?? undefined,
    };

    await finishCapture(uuid, payload, 'chromium', runtimeCorrelation, captureStartTime, url);
    return { uuid, payload };
  } catch (error) {
    const latency = Date.now() - captureStartTime;

    // Categorize error type for metrics
    let errorType: 'capture-failure' | 'timeout' | 'network-error' | 'manifest-error' = 'capture-failure';
    if (error && typeof error === 'object' && 'code' in error) {
      const errorCode = (error as { code: string }).code;
      if (errorCode === 'timeout') {
        errorType = 'timeout';
      } else if (errorCode === 'navigation-failed' || errorCode === 'browser-launch-failed') {
        errorType = 'network-error';
      }
    }

    recordCaptureLatency('other', 'failure', latency);
    recordCaptureOutcome('other', 'failure');
    recordCaptureError('other', errorType);

    logCaptureTelemetry('error', 'capture_failed', runtimeCorrelation, {
      code:
        error && typeof error === 'object' && 'code' in error
          ? (error as { code: string }).code
          : 'browser-launch-failed',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      errorType,
      latencyMs: latency,
    });

    // Re-throw with capture error shape if not already
    if (error && typeof error === 'object' && 'code' in error) {
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    const isNavError =
      msg.includes('ERR_CONNECTION_TIMED_OUT') ||
      msg.includes('ERR_CONNECTION_REFUSED') ||
      msg.includes('ERR_NAME_NOT_RESOLVED') ||
      msg.includes('ERR_ABORTED') ||
      msg.includes('net::ERR_') ||
      msg.includes('page.goto');
    throw {
      code: isNavError ? ('navigation-failed' as const) : ('browser-launch-failed' as const),
      message: msg,
    };
  } finally {
    clearTimeout(timeout);
    await browser?.close().catch(() => {});
  }
}
