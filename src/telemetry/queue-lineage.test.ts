import { describe, expect, it } from 'vitest';
import { buildCaptureTelemetryPayload } from '../capture.js';
import { prepareQueueLineage, startQueueChildSpan } from '../queue.js';

function hex(size: number, fill: string): string {
  return fill.repeat(size);
}

describe('queue lineage', () => {
  it('queue job payload includes traceparent and canonical IDs', () => {
    const correlation = {
      traceId: hex(32, 'a'),
      spanId: hex(16, 'b'),
      requestId: 'req-789',
      dispatchId: 'disp-abc',
      roomId: 'room-1',
      userId: 'user-2',
    };

    const lineage = prepareQueueLineage(correlation);

    expect(lineage.payload.traceparent).toBe(`00-${correlation.traceId}-${correlation.spanId}-01`);
    expect(lineage.payload.trace_id).toBe(correlation.traceId);
    expect(lineage.payload.span_id).toBe(correlation.spanId);
    expect(lineage.payload.request_id).toBe(correlation.requestId);
    expect(lineage.payload.dispatch_id).toBe(correlation.dispatchId);
  });

  it('dequeue extracts parent context and creates child span', () => {
    const traceId = hex(32, 'c');
    const parentSpanId = hex(16, 'd');
    const lineage = prepareQueueLineage({
      traceId,
      spanId: parentSpanId,
      requestId: 'req-1',
      dispatchId: 'disp-1',
    });

    let startSpanCalls = 0;
    const result = startQueueChildSpan(lineage, {
      startSpan: (_name, _options, parentContext) => {
        startSpanCalls += 1;
        const parent = lineage.readParentSpanContext(parentContext);
        expect(parent?.traceId).toBe(traceId);
        expect(parent?.spanId).toBe(parentSpanId);
        return {
          spanContext: () => ({
            traceId,
            spanId: hex(16, 'e'),
            traceFlags: 1,
            isRemote: false,
          }),
          end: () => {},
        };
      },
    });

    expect(startSpanCalls).toBe(1);
    expect(result.workerCorrelation.traceId).toBe(traceId);
  });

  it('child span has different span_id than parent and preserves trace_id', () => {
    const traceId = hex(32, '1');
    const parentSpanId = hex(16, '2');
    const lineage = prepareQueueLineage({
      traceId,
      spanId: parentSpanId,
      requestId: 'req-2',
      dispatchId: 'disp-2',
    });

    const result = startQueueChildSpan(lineage, {
      startSpan: () => ({
        spanContext: () => ({
          traceId,
          spanId: hex(16, '3'),
          traceFlags: 1,
          isRemote: false,
        }),
        end: () => {},
      }),
    });

    expect(result.parentSpanContext?.spanId).toBe(parentSpanId);
    expect(result.childSpanContext?.spanId).toBe(hex(16, '3'));
    expect(result.childSpanContext?.spanId).not.toBe(result.parentSpanContext?.spanId);
    expect(result.childSpanContext?.traceId).toBe(result.parentSpanContext?.traceId);
  });

  it('worker logs include canonical correlation IDs', () => {
    const traceId = hex(32, '4');
    const lineage = prepareQueueLineage({
      traceId,
      spanId: hex(16, '5'),
      requestId: 'req-3',
      dispatchId: 'disp-3',
      roomId: 'room-3',
      userId: 'user-3',
    });

    const result = startQueueChildSpan(lineage, {
      startSpan: () => ({
        spanContext: () => ({
          traceId,
          spanId: hex(16, '6'),
          traceFlags: 1,
          isRemote: false,
        }),
        end: () => {},
      }),
    });

    const payload = buildCaptureTelemetryPayload('capture_started', result.workerCorrelation, {
      url: 'https://example.com/video',
    });

    expect(payload.trace_id).toBe(traceId);
    expect(payload.span_id).toBe(hex(16, '6'));
    expect(payload.request_id).toBe('req-3');
    expect(payload.dispatch_id).toBe('disp-3');
    expect(payload.room_id).toBe('room-3');
    expect(payload.user_id).toBe('user-3');
  });

  it('multiple worker hops preserve trace lineage', () => {
    const traceId = hex(32, '7');
    const root = prepareQueueLineage({
      traceId,
      spanId: hex(16, '8'),
      requestId: 'req-4',
      dispatchId: 'disp-4',
    });

    const hop1 = startQueueChildSpan(root, {
      startSpan: () => ({
        spanContext: () => ({
          traceId,
          spanId: hex(16, '9'),
          traceFlags: 1,
          isRemote: false,
        }),
        end: () => {},
      }),
    });

    const hop2Lineage = prepareQueueLineage(hop1.workerCorrelation);
    const hop2 = startQueueChildSpan(hop2Lineage, {
      startSpan: () => ({
        spanContext: () => ({
          traceId,
          spanId: hex(16, 'a'),
          traceFlags: 1,
          isRemote: false,
        }),
        end: () => {},
      }),
    });

    expect(hop1.childSpanContext?.traceId).toBe(traceId);
    expect(hop2.childSpanContext?.traceId).toBe(traceId);
    expect(hop2.childSpanContext?.spanId).not.toBe(hop1.childSpanContext?.spanId);
  });
});