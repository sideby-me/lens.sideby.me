import { metrics, type ObservableResult } from '@opentelemetry/api';
import type { Queue } from 'bullmq';

const meter = metrics.getMeter('lens.sideby.me', '1.0.0');

// Store current metric values for observable callbacks
const metricValues: {
  waiting: Map<string, number>;
  active: Map<string, number>;
  failed: Map<string, number>;
  waitAge: Map<string, number>;
} = {
  waiting: new Map(),
  active: new Map(),
  failed: new Map(),
  waitAge: new Map(),
};

// Observable gauges
let waitingGauge: ReturnType<typeof meter.createObservableGauge>;
let activeGauge: ReturnType<typeof meter.createObservableGauge>;
let failedGauge: ReturnType<typeof meter.createObservableGauge>;
let waitAgeGauge: ReturnType<typeof meter.createObservableGauge>;
let metricsInitialized = false;

/**
 * Initialize queue metrics instruments.
 * Should be called once during service startup.
 */
export function createQueueMetrics(): void {
  if (metricsInitialized) {
    return;
  }

  waitingGauge = meter.createObservableGauge('queue_depth_waiting', {
    description: 'Number of jobs waiting to be processed',
    unit: '{job}',
  });

  activeGauge = meter.createObservableGauge('queue_depth_active', {
    description: 'Number of jobs currently being processed',
    unit: '{job}',
  });

  failedGauge = meter.createObservableGauge('queue_depth_failed', {
    description: 'Number of failed jobs',
    unit: '{job}',
  });

  waitAgeGauge = meter.createObservableGauge('queue_wait_age_ms', {
    description: 'Age of oldest waiting job in milliseconds',
    unit: 'ms',
  });

  // Register observable callbacks
  waitingGauge.addCallback((observableResult: ObservableResult) => {
    for (const [queueName, value] of metricValues.waiting) {
      observableResult.observe(value, { queue_name: queueName });
    }
  });

  activeGauge.addCallback((observableResult: ObservableResult) => {
    for (const [queueName, value] of metricValues.active) {
      observableResult.observe(value, { queue_name: queueName });
    }
  });

  failedGauge.addCallback((observableResult: ObservableResult) => {
    for (const [queueName, value] of metricValues.failed) {
      observableResult.observe(value, { queue_name: queueName });
    }
  });

  waitAgeGauge.addCallback((observableResult: ObservableResult) => {
    for (const [queueName, value] of metricValues.waitAge) {
      observableResult.observe(value, { queue_name: queueName });
    }
  });

  metricsInitialized = true;
}

/**
 * Update queue metrics with current queue state.
 * Wrapped in try/catch for fail-open behavior (D-17).
 */
export async function updateQueueMetrics(queue: Queue, queueName: string): Promise<void> {
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'failed');

    metricValues.waiting.set(queueName, counts.waiting ?? 0);
    metricValues.active.set(queueName, counts.active ?? 0);
    metricValues.failed.set(queueName, counts.failed ?? 0);

    // Calculate wait age from oldest waiting job
    const waitingJobs = await queue.getWaiting(0, 1);
    if (waitingJobs.length > 0 && waitingJobs[0]?.timestamp) {
      const age = Date.now() - waitingJobs[0].timestamp;
      metricValues.waitAge.set(queueName, Math.max(0, age));
    } else {
      metricValues.waitAge.set(queueName, 0);
    }
  } catch (err) {
    // Fail-open: log warning but do not propagate error (D-17)
    console.warn('[lens:queue-metrics] Failed to update queue metrics', {
      queueName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Start periodic queue metrics polling.
 * Returns a stop function to clear the interval.
 */
export function startQueueMetricsPolling(
  queue: Queue,
  queueName: string,
  intervalMs: number = 15000
): () => void {
  // Initial update
  void updateQueueMetrics(queue, queueName);

  // Set up periodic polling
  const intervalId = setInterval(() => {
    void updateQueueMetrics(queue, queueName);
  }, intervalMs);

  // Return stop function
  return () => {
    clearInterval(intervalId);
  };
}

/**
 * Clear all metric values (for testing).
 */
export function clearQueueMetrics(): void {
  metricValues.waiting.clear();
  metricValues.active.clear();
  metricValues.failed.clear();
  metricValues.waitAge.clear();
}
