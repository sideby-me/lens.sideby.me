import type { TelemetryCorrelation } from '../types.js';

/**
 * Queue job payload carrier for trace context and canonical IDs.
 * Dequeue must create a child span while preserving trace lineage.
 */
export interface QueueCorrelationPayload {
  traceparent: string;
  baggage?: string;
  trace_id: string;
  span_id: string;
  request_id: string;
  dispatch_id: string;
  room_id?: string | null;
  user_id?: string | null;
}

/**
 * Build queue correlation payload from TelemetryCorrelation.
 */
export function buildQueueCorrelation(
  correlation: TelemetryCorrelation,
  traceparent: string,
  baggage?: string
): QueueCorrelationPayload {
  return {
    traceparent,
    baggage,
    trace_id: correlation.traceId ?? '',
    span_id: correlation.spanId ?? '',
    request_id: correlation.requestId ?? '',
    dispatch_id: correlation.dispatchId ?? '',
    room_id: correlation.roomId ?? null,
    user_id: correlation.userId ?? null,
  };
}

/**
 * Extract correlation from queue job data.
 */
export function extractQueueCorrelation(
  payload: QueueCorrelationPayload
): TelemetryCorrelation & { traceparent: string; baggage?: string } {
  return {
    traceparent: payload.traceparent,
    baggage: payload.baggage,
    traceId: payload.trace_id,
    spanId: payload.span_id,
    requestId: payload.request_id,
    dispatchId: payload.dispatch_id,
    roomId: payload.room_id,
    userId: payload.user_id,
  };
}
