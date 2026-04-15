import fs from 'fs';
import dotenv from 'dotenv';
if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' });
}
dotenv.config();
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createQueue, startWorker, createQueueEvents } from './queue.js';
import { writeEvent, closeSSE } from './sse.js';
import { dedupCheck, dedupDelete } from './dedup.js';
import { readKV } from './kv.js';
import { storeUuidCorrelation } from './uuid-bridge.js';
import { initializeTelemetry } from './telemetry/bootstrap.js';
import { logInfo, logWarn } from './telemetry/logs.js';
import type { CaptureResult, CaptureError } from './types.js';
import type { Response } from 'express';
import type { TelemetryCorrelation } from './types.js';

await initializeTelemetry({
  logger: {
    warn: (message, meta) => {
      logWarn(message, {
        domain: 'other',
        event: 'telemetry_bootstrap',
        ...(meta ?? {}),
      });
    },
    info: (message, meta) => {
      logInfo(message, {
        domain: 'other',
        event: 'telemetry_bootstrap',
        ...(meta ?? {}),
      });
    },
  },
});

const app = express();
app.use(express.json());

const PORT = Number(process.env.LENS_PORT ?? 4000);
const SHARED_SECRET = process.env.LENS_SHARED_SECRET ?? '';

function parseTraceparent(traceparent: string | undefined): Pick<TelemetryCorrelation, 'traceId' | 'spanId'> {
  if (!traceparent) {
    return {};
  }

  const trimmed = traceparent.trim();
  const parts = trimmed.split('-');
  if (parts.length < 4) {
    return {};
  }

  const traceId = parts[1];
  const spanId = parts[2];
  if (!traceId || !spanId) {
    return {};
  }

  return { traceId, spanId };
}

function readCorrelation(req: express.Request): TelemetryCorrelation {
  const traceparent = req.header('traceparent') ?? undefined;
  const parsedTrace = parseTraceparent(traceparent);

  return {
    ...parsedTrace,
    requestId: req.header('x-request-id') ?? undefined,
    dispatchId: req.header('x-dispatch-id') ?? undefined,
    roomId: req.header('x-room-id') ?? null,
    userId: req.header('x-user-id') ?? null,
  };
}

// Auth middleware
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!SHARED_SECRET) {
    next();
    return;
  }
  const token = req.headers['x-lens-secret'];
  if (token !== SHARED_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// Active SSE connections keyed by job ID
const activeStreams = new Map<string, Response>();

// Queue setup
const queue = createQueue();

const _worker = startWorker({
  onCompleted: (jobId: string, result: CaptureResult) => {
    const res = activeStreams.get(jobId);
    if (!res) return;

    const pipeProxyUrl = process.env.PIPE_PROXY_URL ?? 'https://pipe.sideby.me';
    writeEvent(res, 'done', {
      uuid: result.uuid,
      playbackUrl: `${pipeProxyUrl}?uuid=${result.uuid}`,
      mediaType: result.payload.mediaType,
      expiresAt: result.payload.expiresAt,
      lowConfidence: result.payload.lowConfidence,
      ambiguous: result.payload.ambiguous,
      alternatives: result.payload.alternatives,
    });
    closeSSE(res);
    activeStreams.delete(jobId);
  },
  onFailed: (jobId: string, error: CaptureError) => {
    const res = activeStreams.get(jobId);
    if (!res) return;

    writeEvent(res, 'error', {
      code: error.code,
      message: error.message,
    });
    closeSSE(res);
    activeStreams.delete(jobId);
  },
});

// Observability - logs completed/failed events from the queue for monitoring
const _queueEvents = createQueueEvents();

app.get('/_health', (_req, res) => {
  res.status(200);
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.send("oh hello! it works btw, if that's what you are wondering");
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'lens' });
});

app.post('/capture', authMiddleware, async (req, res) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing url in request body' });
    return;
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  // Set up SSE response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Deduplication check
  try {
    const cachedUuid = await dedupCheck(url);
    if (cachedUuid) {
      // Verify KV entry is still valid
      const payload = await readKV(cachedUuid);
      if (payload && payload.expiresAt > Date.now()) {
        // Still valid - return immediately
        const pipeProxyUrl = process.env.PIPE_PROXY_URL ?? 'https://pipe.sideby.me';
        writeEvent(res, 'done', {
          uuid: cachedUuid,
          playbackUrl: `${pipeProxyUrl}?uuid=${cachedUuid}`,
          mediaType: payload.mediaType,
          expiresAt: payload.expiresAt,
          lowConfidence: payload.lowConfidence,
          ambiguous: payload.ambiguous,
          alternatives: payload.alternatives,
        });
        closeSSE(res);
        return;
      }
      // Stale - delete dedup key and re-enqueue
      await dedupDelete(url);
    }
  } catch (err) {
    logWarn('Dedup check failed, proceeding with capture', {
      domain: 'other',
      event: 'dedup_check_failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Enqueue capture job
  const uuid = uuidv4();
  const correlation = readCorrelation(req);
  writeEvent(res, 'status', { status: 'queued', uuid });

  try {
    const job = await queue.add('capture', { url, uuid, correlation }, { jobId: uuid });

    try {
      await storeUuidCorrelation(uuid, {
        ...correlation,
        traceparent: req.header('traceparent') ?? undefined,
        baggage: req.header('baggage') ?? undefined,
      });
    } catch (bridgeErr) {
      logWarn('UUID correlation bridge store failed', {
        domain: 'other',
        event: 'uuid_correlation_bridge_store_failed',
        uuid,
        err: bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr),
      });
    }

    activeStreams.set(job.id!, res);

    writeEvent(res, 'status', { status: 'processing' });

    // Clean up on client disconnect
    req.on('close', () => {
      activeStreams.delete(job.id!);
    });
  } catch (err) {
    writeEvent(res, 'error', {
      code: 'browser-launch-failed',
      message: err instanceof Error ? err.message : String(err),
    });
    closeSSE(res);
  }
});

// Relay endpoint: pipe calls this when a captured token is IP-bound.
// The home server makes the upstream fetch from its own IP (which signed the token).
app.post('/relay/fetch', authMiddleware, async (req, res) => {
  const { url, headers } = req.body as { url?: string; headers?: Record<string, unknown> };

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing url' });
    return;
  }
  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  const forwardHeaders: Record<string, string> = {};
  if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v === 'string') forwardHeaders[k] = v;
    }
  }

  try {
    const upstream = await fetch(url, { headers: forwardHeaders, redirect: 'follow' });
    const body = await upstream.text();
    res.json({
      status: upstream.status,
      contentType: upstream.headers.get('content-type') ?? 'application/octet-stream',
      cacheControl: upstream.headers.get('cache-control') ?? null,
      body,
    });
  } catch (err) {
    res.status(502).json({
      error: 'Relay fetch failed',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// Start the server
app.listen(PORT, () => {
  logInfo('Server listening on port', {
    domain: 'other',
    event: 'server_start',
    port: PORT,
  });
});

