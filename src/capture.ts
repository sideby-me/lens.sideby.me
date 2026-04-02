import { chromium } from 'patchright';
import { v4 as uuidv4 } from 'uuid';
import { context, trace } from '@opentelemetry/api';
import { runObservationLoop } from './pipeline/observation-loop.js';
import { putKV } from './kv.js';
import { dedupSet } from './dedup.js';
import { buildCorrelationFields, redactTelemetryPayload } from './redaction.js';
import { recordCaptureStart, recordCaptureOutcome, recordCaptureError } from './telemetry/metrics.js';
import type { CaptureResult, LensPayload, TelemetryCorrelation } from './types.js';

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
    console.error('[lens:telemetry]', line);
    return;
  }
  if (level === 'warn') {
    console.warn('[lens:telemetry]', line);
    return;
  }
  console.log('[lens:telemetry]', line);
}

// Detect token expiry from URL query parameters
function detectExpiry(url: string): number | null {
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;

    // exp= (epoch seconds)
    const exp = params.get('exp') ?? params.get('expires');
    if (exp) {
      const val = Number(exp);
      // If it looks like epoch seconds (> year 2000)
      if (val > 946_684_800 && val < 32_503_680_000) return val * 1000;
    }

    // X-Amz-Expires (relative seconds from X-Amz-Date)
    const amzExpires = params.get('X-Amz-Expires');
    const amzDate = params.get('X-Amz-Date');
    if (amzExpires && amzDate) {
      // X-Amz-Date format: 20240101T000000Z
      const dateMatch = amzDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
      if (dateMatch) {
        const date = new Date(
          `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${dateMatch[4]}:${dateMatch[5]}:${dateMatch[6]}Z`
        );
        return date.getTime() + Number(amzExpires) * 1000;
      }
    }

    return null;
  } catch {
    return null;
  }
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

  let browser;
  try {
    // Launch patchright's chromium - patches WebDriver fingerprints at binary level
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
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
      pageUrl: url, // used for Referer injection on alternatives
    });

    console.info(
      `[lens] Captured ${result.winner.url} (score: ${result.winner.score}, runner-up: ${result.runnerUpScore ?? 'none'}, candidates: ${result.candidateCount})`
    );

    if (result.lowConfidence) {
      console.warn(
        `[lens] Low confidence capture for ${url} — best score: ${result.winner.score}, candidates: ${result.candidateCount}`
      );
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
    };

    // Write to KV
    await putKV(uuid, payload, expiresAt);

    // Record dedup mapping
    await dedupSet(url, uuid);

    logCaptureTelemetry('info', 'capture_completed', runtimeCorrelation, {
      uuid,
      mediaType: payload.mediaType,
      lowConfidence: payload.lowConfidence,
      ambiguous: payload.ambiguous,
    });

    // Record golden signal metrics
    const mediaType = result.winner.mediaType;
    const stopTimer = recordCaptureStart(mediaType);
    const latency = Date.now() - captureStartTime;
    stopTimer();
    recordCaptureOutcome(mediaType, 'success');

    return { uuid, payload };
  } catch (error) {
    const latency = Date.now() - captureStartTime;
    
    // Categorize error type for metrics
    let errorType: 'capture-failure' | 'timeout' | 'network-error' | 'manifest-error' = 'capture-failure';
    if (error && typeof error === 'object' && 'code' in error) {
      const errorCode = (error as { code: string }).code;
      if (errorCode === 'timeout') {
        errorType = 'timeout';
      } else if (errorCode === 'browser-launch-failed') {
        errorType = 'network-error';
      }
    }
    
    recordCaptureError('other', errorType);
    
    logCaptureTelemetry('error', 'capture_failed', runtimeCorrelation, {
      code: error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : 'browser-launch-failed',
      message: error instanceof Error ? error.message : String(error),
    });

    // Re-throw with capture error shape if not already
    if (error && typeof error === 'object' && 'code' in error) {
      throw error;
    }
    throw {
      code: 'browser-launch-failed' as const,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
    await browser?.close().catch(() => {});
  }
}

