/**
 * Golden signal metric instruments for the lens capture path.
 *
 * Exposes latency, error rate, and throughput metrics for capture operations
 * following the OpenTelemetry semantic conventions.
 *
 * All metric calls are wrapped in try/catch for fail-open behavior.
 */

import { metrics, Counter, Histogram } from '@opentelemetry/api';

type CaptureOutcome = 'success' | 'failure' | 'timeout';
type CaptureErrorType = 'capture-failure' | 'timeout' | 'network-error' | 'manifest-error';
type CaptureMediaType = 'hls' | 'dash' | 'mp4' | 'other';

interface CaptureMetrics {
  requestsTotal: Counter;
  latencyMs: Histogram;
  errorsTotal: Counter;
}

let captureMetrics: CaptureMetrics | null = null;

/**
 * Creates and caches the capture metric instruments.
 * Safe to call multiple times - returns cached instruments.
 */
export function createCaptureMetrics(): CaptureMetrics {
  if (captureMetrics) {
    return captureMetrics;
  }

  const meter = metrics.getMeter('lens.sideby.me', '1.0.0');

  const requestsTotal = meter.createCounter('capture_requests_total', {
    description: 'Total number of capture requests',
    unit: '{request}',
  });

  const latencyMs = meter.createHistogram('capture_latency_ms', {
    description: 'Capture request latency in milliseconds',
    unit: 'ms',
  });

  const errorsTotal = meter.createCounter('capture_errors_total', {
    description: 'Total number of capture errors',
    unit: '{error}',
  });

  captureMetrics = {
    requestsTotal,
    latencyMs,
    errorsTotal,
  };

  return captureMetrics;
}

/**
 * Records the start of a capture request.
 * Returns a stop function that records the latency when called.
 *
 * @param mediaType - The media type being captured (e.g., 'hls', 'mp4')
 * @returns A stop function that records latency and returns the duration in ms
 */
export function recordCaptureStart(mediaType: CaptureMediaType): () => number {
  const startTime = Date.now();
  const metricsInstance = createCaptureMetrics();

  return (): number => {
    const duration = Date.now() - startTime;

    try {
      metricsInstance.latencyMs.record(duration, {
        media_type: mediaType,
        outcome: 'success',
      });
    } catch {
      // Fail-open: metric recording errors must not affect capture behavior
    }

    return duration;
  };
}

/**
 * Records a capture request outcome.
 *
 * @param mediaType - The media type being captured
 * @param outcome - The outcome of the capture request
 */
export function recordCaptureOutcome(
  mediaType: CaptureMediaType,
  outcome: CaptureOutcome
): void {
  const metricsInstance = createCaptureMetrics();

  try {
    metricsInstance.requestsTotal.add(1, {
      media_type: mediaType,
      outcome,
    });
  } catch {
    // Fail-open: metric recording errors must not affect capture behavior
  }
}

/**
 * Records a capture error.
 *
 * @param mediaType - The media type being captured
 * @param errorType - The type of error that occurred
 */
export function recordCaptureError(
  mediaType: CaptureMediaType,
  errorType: CaptureErrorType
): void {
  const metricsInstance = createCaptureMetrics();

  try {
    metricsInstance.errorsTotal.add(1, {
      media_type: mediaType,
      error_type: errorType,
    });
  } catch {
    // Fail-open: metric recording errors must not affect capture behavior
  }
}
