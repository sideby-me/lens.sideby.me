import { describe, expect, it } from 'vitest';
import { initializeTelemetry, resolveTelemetryResourceAttributes } from './bootstrap.js';
import { buildQueueTelemetryPayload } from '../queue.js';
import { buildCaptureTelemetryPayload } from '../capture.js';
import { buildCorrelationFields, redactTelemetryPayload } from '../redaction.js';

describe('lens telemetry bootstrap contract', () => {
  it('exposes required resource attributes', () => {
    const attributes = resolveTelemetryResourceAttributes({
      NODE_ENV: 'test',
      npm_package_version: '1.2.3',
      OTEL_SERVICE_NAME: 'lens-test',
    });

    expect(attributes['service.name']).toBe('lens-test');
    expect(attributes['service.version']).toBe('1.2.3');
    expect(attributes['deployment.environment']).toBe('test');
  });

  it('keeps runtime fail-open when exporter initialization fails', async () => {
    const warnings: string[] = [];

    await expect(
      initializeTelemetry({
        env: {
          NODE_ENV: 'test',
          npm_package_version: '1.0.0',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:0',
        },
        logger: {
          warn: message => {
            warnings.push(message);
          },
        },
        sdkFactory: () => {
          throw new Error('exporter unavailable');
        },
      })
    ).resolves.not.toThrow();

    expect(warnings.some(w => w.includes('telemetry bootstrap failed'))).toBe(true);
  });
});

describe('lens telemetry correlation and redaction contract', () => {
  it('includes canonical correlation keys for queue and capture payloads', () => {
    const correlation = {
      traceId: 'trace-abc',
      spanId: 'span-xyz',
      requestId: 'req-1',
      dispatchId: 'disp-2',
      roomId: 'room-7',
      userId: 'user-9',
    };

    const queuePayload = buildQueueTelemetryPayload('queue_job_started', correlation, {
      jobId: 'job-123',
    });
    const capturePayload = buildCaptureTelemetryPayload('capture_completed', correlation, {
      candidateCount: 3,
    });

    expect(queuePayload.trace_id).toBe('trace-abc');
    expect(queuePayload.span_id).toBe('span-xyz');
    expect(queuePayload.request_id).toBe('req-1');
    expect(queuePayload.dispatch_id).toBe('disp-2');
    expect(queuePayload.room_id).toBe('room-7');
    expect(queuePayload.user_id).toBe('user-9');

    expect(capturePayload.trace_id).toBe('trace-abc');
    expect(capturePayload.span_id).toBe('span-xyz');
    expect(capturePayload.request_id).toBe('req-1');
    expect(capturePayload.dispatch_id).toBe('disp-2');
    expect(capturePayload.room_id).toBe('room-7');
    expect(capturePayload.user_id).toBe('user-9');
  });

  it('redacts email, user text, and IP fields before emit', () => {
    const redacted = redactTelemetryPayload({
      email: 'person@example.com',
      messageText: 'my private note',
      ip: '203.0.113.42',
      trace_id: 'trace-1',
    });

    expect(redacted.email).toBe('[REDACTED]');
    expect(redacted.messageText).toBe('[REDACTED]');
    expect(redacted.ip).toBe('[REDACTED]');
    expect(redacted.trace_id).toBe('trace-1');
  });

  it('warns for missing non-core IDs and keeps payload emitted', () => {
    const warnings: string[] = [];
    const fields = buildCorrelationFields(
      {
        traceId: 'trace-abc',
        spanId: 'span-xyz',
        requestId: 'req-1',
        dispatchId: 'disp-2',
      },
      message => {
        warnings.push(message);
      }
    );

    expect(fields.room_id).toBeNull();
    expect(fields.user_id).toBeNull();
    expect(fields.trace_id).toBe('trace-abc');
    expect(fields.request_id).toBe('req-1');
    expect(warnings.length).toBeGreaterThan(0);
  });
});
