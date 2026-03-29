import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { capture } from './capture.js';
import { buildCorrelationFields, redactTelemetryPayload } from './redaction.js';
import type { CaptureResult, LensJob, CaptureError, TelemetryCorrelation } from './types.js';

const QUEUE_NAME = 'lens-capture';

let connection: Redis | null = null;

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
  return new Queue<LensJob>(QUEUE_NAME, {
    connection: getConnection(),
  });
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
    console.error('[lens:telemetry]', line);
    return;
  }
  if (level === 'warn') {
    console.warn('[lens:telemetry]', line);
    return;
  }
  console.log('[lens:telemetry]', line);
}

// Start the BullMQ worker that processes capture jobs
export function startWorker(callbacks: QueueCallbacks): Worker<LensJob, CaptureResult> {
  const concurrency = Number(process.env.LENS_CONCURRENCY ?? 2);

  const worker = new Worker<LensJob, CaptureResult>(
    QUEUE_NAME,
    async (job: Job<LensJob, CaptureResult>) => {
      const correlation = job.data.correlation ?? {};
      logQueueTelemetry('info', 'queue_job_started', correlation, {
        jobId: job.id ?? null,
      });
      console.log(`[lens] Processing job ${job.id} for ${job.data.url}`);
      return capture(job.data.url, correlation);
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
      console.log(`[lens] Job ${job.id} completed: uuid=${result.uuid}`);
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
      });
      console.error(`[lens] Job ${job.id} failed:`, captureErr);
      callbacks.onFailed(job.id, captureErr);
    }
  });

  console.log(`[lens] Worker started with concurrency=${concurrency}`);
  return worker;
}

// Create a QueueEvents instance for observability (logging, monitoring)
export function createQueueEvents(): QueueEvents {
  const events = new QueueEvents(QUEUE_NAME, { connection: getConnection() });

  events.on('completed', ({ jobId }) => {
    console.log(`[lens:QueueEvents] Job ${jobId} completed`);
  });

  events.on('failed', ({ jobId, failedReason }) => {
    console.error(`[lens:QueueEvents] Job ${jobId} failed: ${failedReason}`);
  });

  return events;
}
