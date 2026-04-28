import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { context, propagation, trace, type Context, type Span } from '@opentelemetry/api';
import { capture } from './capture.js';
import { buildCorrelationFields, redactTelemetryPayload } from './redaction.js';
import { buildQueueCorrelation, extractQueueCorrelation } from './telemetry/queue-correlation.js';
import { logError, logInfo, logWarn } from './telemetry/logs.js';
import { createQueueMetrics, startQueueMetricsPolling } from './queue-metrics.js';
import type { CaptureResult, LensJob, CaptureError, TelemetryCorrelation } from './types.js';
import type { QueueCorrelationPayload } from './telemetry/queue-correlation.js';

const QUEUE_NAME = 'lens-capture';
const QUEUE_METRICS_INTERVAL_MS = 300_000; // 5 minutes

// Initialize queue metrics once
createQueueMetrics();

// Store stop function for graceful shutdown
let queueMetricsStop: (() => void) | null = null;

let connection: Redis | null = null;

const W3C_VERSION = '00';
const W3C_TRACE_FLAGS = '01';

function normalizeHex(value: string | undefined, length: number): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  const pattern = length === 32 ? /^[0-9a-f]{32}$/ : /^[0-9a-f]{16}$/;
  return pattern.test(trimmed) ? trimmed : null;
}

function randomHex(length: number): string {
  let output = '';
  while (output.length < length) {
    output += Math.floor(Math.random() * 16).toString(16);
  }
  return output.slice(0, length);
}

function buildTraceparent(correlation: TelemetryCorrelation): string {
  const traceId = normalizeHex(correlation.traceId, 32) ?? randomHex(32);
  const spanId = normalizeHex(correlation.spanId, 16) ?? randomHex(16);
  return `${W3C_VERSION}-${traceId}-${spanId}-${W3C_TRACE_FLAGS}`;
}

function parseTraceparent(traceparent: string): { traceId: string; spanId: string; traceFlags: number } | null {
  const parts = traceparent.trim().split('-');
  if (parts.length !== 4) {
    return null;
  }

  const traceId = normalizeHex(parts[1], 32);
  const spanId = normalizeHex(parts[2], 16);
  const traceFlags = Number.parseInt(parts[3], 16);
  if (!traceId || !spanId || Number.isNaN(traceFlags)) {
    return null;
  }

  return { traceId, spanId, traceFlags };
}

export interface QueueLineageContext {
  payload: QueueCorrelationPayload;
  extractedCorrelation: TelemetryCorrelation & { traceparent: string; baggage?: string };
  parentContext: Context;
  parentSpanContext?: ReturnType<typeof trace.getSpanContext>;
  readParentSpanContext: (target: Context) => ReturnType<typeof trace.getSpanContext>;
}

export interface QueueChildSpanLike {
  spanContext: () => { traceId: string; spanId: string };
  end: () => void;
}

export interface QueueSpanStarter {
  startSpan: (name: string, options: undefined, parentContext: Context) => QueueChildSpanLike;
}

export function prepareQueueLineage(correlation: TelemetryCorrelation = {}): QueueLineageContext {
  const payload = buildQueueCorrelation(correlation, buildTraceparent(correlation));
  const extractedCorrelation = extractQueueCorrelation(payload);
  const carrier: Record<string, string> = {
    traceparent: extractedCorrelation.traceparent,
  };
  if (extractedCorrelation.baggage) {
    carrier.baggage = extractedCorrelation.baggage;
  }

  const extractedContext = propagation.extract(context.active(), carrier);
  const parsedParent = parseTraceparent(extractedCorrelation.traceparent);
  const parentContext = parsedParent
    ? trace.setSpanContext(extractedContext, {
        traceId: parsedParent.traceId,
        spanId: parsedParent.spanId,
        traceFlags: parsedParent.traceFlags,
        isRemote: true,
      })
    : extractedContext;
  return {
    payload,
    extractedCorrelation,
    parentContext,
    parentSpanContext: trace.getSpanContext(parentContext),
    readParentSpanContext: (target: Context) => trace.getSpanContext(target),
  };
}

export function startQueueChildSpan(
  lineage: QueueLineageContext,
  spanStarter: QueueSpanStarter = trace.getTracer('lens')
): {
  childSpan: QueueChildSpanLike;
  childSpanContext: { traceId: string; spanId: string };
  parentSpanContext?: ReturnType<typeof trace.getSpanContext>;
  workerCorrelation: TelemetryCorrelation;
} {
  const childSpan = spanStarter.startSpan('capture.process', undefined, lineage.parentContext);
  const childSpanContext = childSpan.spanContext();

  return {
    childSpan,
    childSpanContext,
    parentSpanContext: lineage.parentSpanContext,
    workerCorrelation: {
      ...lineage.extractedCorrelation,
      traceId: childSpanContext.traceId || lineage.extractedCorrelation.traceId,
      spanId: childSpanContext.spanId || lineage.extractedCorrelation.spanId,
    },
  };
}

function getConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null, // Required by BullMQ
    });
  }
  return connection;
}

// Create the BullMQ queue for capture jobs
export function createQueue(): Queue<LensJob> {
  const queue = new Queue<LensJob>(QUEUE_NAME, {
    connection: getConnection(),
  });

  // Start queue metrics polling
  queueMetricsStop = startQueueMetricsPolling(queue, QUEUE_NAME, QUEUE_METRICS_INTERVAL_MS);
  logInfo('Queue metrics polling started', {
    domain: 'queue',
    event: 'queue_metrics_poll_start',
    queue: QUEUE_NAME,
  });

  return queue;
}

// Stop queue metrics polling (for graceful shutdown)
export function stopQueueMetrics(): void {
  if (queueMetricsStop) {
    queueMetricsStop();
    queueMetricsStop = null;
    logInfo('Queue metrics polling stopped', {
      domain: 'queue',
      event: 'queue_metrics_poll_stop',
      queue: QUEUE_NAME,
    });
  }
}

/** Job event callback types */
export interface QueueCallbacks {
  onCompleted: (jobId: string, result: CaptureResult) => void;
  onFailed: (jobId: string, error: CaptureError) => void;
}

export function buildQueueTelemetryPayload(
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

function logQueueTelemetry(
  level: 'info' | 'warn' | 'error',
  event: string,
  correlation: TelemetryCorrelation = {},
  payload: Record<string, unknown> = {}
): void {
  const line = JSON.stringify(buildQueueTelemetryPayload(event, correlation, payload));
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

// Start the BullMQ worker that processes capture jobs
export function startWorker(callbacks: QueueCallbacks): Worker<LensJob, CaptureResult> {
  const concurrency = Number(process.env.LENS_CONCURRENCY ?? 2);
  const tracer = trace.getTracer('lens');

  const worker = new Worker<LensJob, CaptureResult>(
    QUEUE_NAME,
    async (job: Job<LensJob, CaptureResult>) => {
      const correlation = job.data.correlation ?? {};
      const lineage = prepareQueueLineage(correlation);
      const { childSpan, workerCorrelation } = startQueueChildSpan(lineage, tracer);

      logQueueTelemetry('info', 'queue_job_started', workerCorrelation, {
        jobId: job.id ?? null,
      });
      logInfo('Processing queue job', {
        domain: 'queue',
        event: 'queue_job_processing',
        jobId: job.id ?? null,
        url: job.data.url,
      });
      try {
        return await context.with(trace.setSpan(lineage.parentContext, childSpan as Span), () =>
          capture(job.data.url, workerCorrelation)
        );
      } finally {
        childSpan.end();
      }
    },
    {
      connection: getConnection(),
      concurrency,
    }
  );

  worker.on('completed', (job, result) => {
    if (job?.id) {
      logQueueTelemetry('info', 'queue_job_completed', job.data.correlation, {
        jobId: job.id,
        uuid: result.uuid,
      });
      logInfo('Queue job completed', {
        domain: 'queue',
        event: 'queue_job_completed',
        jobId: job.id,
        uuid: result.uuid,
      });
      callbacks.onCompleted(job.id, result);
    }
  });

  worker.on('failed', (job, err) => {
    if (job?.id) {
      const captureErr: CaptureError =
        err && typeof err === 'object' && 'code' in err
          ? (err as unknown as CaptureError)
          : { code: 'browser-launch-failed', message: String(err) };
      logQueueTelemetry('error', 'queue_job_failed', job.data.correlation, {
        jobId: job.id,
        code: captureErr.code,
        message: captureErr.message,
      });
      logError('Queue job failed', {
        domain: 'queue',
        event: 'queue_job_failed',
        jobId: job.id,
        code: captureErr.code,
        message: captureErr.message,
      });
      callbacks.onFailed(job.id, captureErr);
    }
  });

  logInfo('Queue worker started', {
    domain: 'queue',
    event: 'queue_worker_started',
    concurrency,
  });
  return worker;
}

// Create a QueueEvents instance for observability (logging, monitoring)
export function createQueueEvents(): QueueEvents {
  const events = new QueueEvents(QUEUE_NAME, { connection: getConnection() });

  events.on('completed', ({ jobId }) => {
    logInfo('Queue events completed', {
      domain: 'queue',
      event: 'queue_events_completed',
      jobId,
    });
  });

  events.on('failed', ({ jobId, failedReason }) => {
    logError('Queue events failed', {
      domain: 'queue',
      event: 'queue_events_failed',
      jobId,
      failedReason,
    });
  });

  return events;
}
