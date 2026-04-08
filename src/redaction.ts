import { logWarn } from './telemetry/logs.js';

export interface TelemetryCorrelationInput {
  traceId?: string;
  spanId?: string;
  requestId?: string;
  dispatchId?: string;
  roomId?: string | null;
  userId?: string | null;
}

export interface TelemetryCorrelationFields {
  trace_id: string | null;
  span_id: string | null;
  request_id: string | null;
  dispatch_id: string | null;
  room_id: string | null;
  user_id: string | null;
}

type WarnFn = (message: string) => void;

const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('email') ||
    lower.includes('message') ||
    lower.includes('text') ||
    lower === 'ip' ||
    lower.endsWith('_ip') ||
    lower.includes('ip_address')
  );
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (isSensitiveKey(key) && typeof entry === 'string') {
      output[key] = REDACTED;
      continue;
    }

    if (entry && typeof entry === 'object') {
      output[key] = redactValue(entry);
      continue;
    }

    output[key] = entry;
  }

  return output;
}

export function redactTelemetryPayload(input: Record<string, unknown>): Record<string, unknown> {
  return redactValue(input) as Record<string, unknown>;
}

export function buildCorrelationFields(
  correlation: TelemetryCorrelationInput,
  warn: WarnFn = message => logWarn(message, { domain: 'other', event: 'correlation_missing_non_core_ids' })
): TelemetryCorrelationFields {
  const fields: TelemetryCorrelationFields = {
    trace_id: correlation.traceId ?? null,
    span_id: correlation.spanId ?? null,
    request_id: correlation.requestId ?? null,
    dispatch_id: correlation.dispatchId ?? null,
    room_id: correlation.roomId ?? null,
    user_id: correlation.userId ?? null,
  };

  if (!fields.room_id || !fields.user_id) {
    warn('lens telemetry missing non-core correlation IDs');
  }

  return fields;
}
