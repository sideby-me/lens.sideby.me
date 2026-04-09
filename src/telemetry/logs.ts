import { logs, SeverityNumber } from '@opentelemetry/api-logs';

type LensLogLevel = 'info' | 'warn' | 'error';
type LensAttributeValue = string | number | boolean;

interface LensStructuredLog {
  level: LensLogLevel;
  service: 'lens';
  domain?: string;
  event?: string;
  message: string;
  ts: number;
  request_id?: string | null;
  dispatch_id?: string | null;
  trace_id?: string | null;
  span_id?: string | null;
  room_id?: string | null;
  user_id?: string | null;
  meta?: Record<string, unknown>;
}

let telemetryLogsEnabled = false;
let telemetryLoggerVersion = '1.0.0';

function mapSeverityNumber(level: LensLogLevel): SeverityNumber {
  switch (level) {
    case 'error':
      return SeverityNumber.ERROR;
    case 'warn':
      return SeverityNumber.WARN;
    default:
      return SeverityNumber.INFO;
  }
}

function toMessagePart(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isLensMarker(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === '[lens]' ||
    normalized === '[lens:telemetry]' ||
    normalized === '[lens:queue-metrics]' ||
    normalized === '[lens:queueevents]'
  );
}

function normalizeMessageText(value: string): string {
  return value.replace(/^\[lens(?::[^\]]+)?\]\s*/i, '').trim();
}

function buildMessage(args: unknown[]): string {
  const parts: string[] = [];

  for (const arg of args) {
    if (typeof arg === 'string') {
      if (isLensMarker(arg)) {
        continue;
      }

      const normalized = normalizeMessageText(arg);
      if (!normalized) {
        continue;
      }

      const parsed = tryParseJsonRecord(normalized);
      if (parsed) {
        if (typeof parsed.message === 'string' && parsed.message.trim()) {
          parts.push(parsed.message.trim());
          continue;
        }

        if (typeof parsed.event === 'string' && parsed.event.trim()) {
          parts.push(parsed.event.trim());
          continue;
        }

        continue;
      }

      parts.push(normalized);
      continue;
    }

    if (arg instanceof Error) {
      parts.push(toMessagePart(arg));
    }
  }

  return parts.join(' ').trim() || 'lens_event';
}

function toSerializable(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map(item => toSerializable(item, seen));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = toSerializable(nested, seen);
  }
  return out;
}

function tryParseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function extractMeta(args: unknown[]): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (typeof arg === 'string') {
      if (isLensMarker(arg)) {
        continue;
      }

      const parsed = tryParseJsonRecord(normalizeMessageText(arg));
      if (parsed) {
        Object.assign(meta, parsed);
        continue;
      }

      continue;
    }

    if (arg instanceof Error) {
      meta.error = toSerializable(arg);
      continue;
    }

    if (arg && typeof arg === 'object') {
      const serialized = toSerializable(arg);
      if (serialized && typeof serialized === 'object' && !Array.isArray(serialized)) {
        Object.assign(meta, serialized as Record<string, unknown>);
      }
      continue;
    }

    if (typeof arg !== 'string') {
      meta[`arg_${i}`] = toSerializable(arg);
    }
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

function readOptionalString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalNullableString(
  meta: Record<string, unknown> | undefined,
  key: string
): string | null | undefined {
  const value = meta?.[key];
  if (value === null) {
    return null;
  }

  return typeof value === 'string' ? value : undefined;
}

function buildStructuredLog(level: LensLogLevel, args: unknown[]): LensStructuredLog {
  const meta = extractMeta(args);

  return {
    level,
    service: 'lens',
    domain: readOptionalString(meta, 'domain'),
    event: readOptionalString(meta, 'event'),
    message: buildMessage(args),
    ts: Date.now(),
    request_id: readOptionalNullableString(meta, 'request_id'),
    dispatch_id: readOptionalNullableString(meta, 'dispatch_id'),
    trace_id: readOptionalNullableString(meta, 'trace_id'),
    span_id: readOptionalNullableString(meta, 'span_id'),
    room_id: readOptionalNullableString(meta, 'room_id'),
    user_id: readOptionalNullableString(meta, 'user_id'),
    meta,
  };
}

function extractTelemetryAttributes(payload: LensStructuredLog): Record<string, LensAttributeValue> {
  const attributes: Record<string, LensAttributeValue> = {
    'log.level': payload.level,
    'log.source': 'lens.application',
  };

  if (payload.domain) {
    attributes.domain = payload.domain;
  }

  if (payload.event) {
    attributes.event = payload.event;
  }

  const promotedKeys = ['request_id', 'dispatch_id', 'trace_id', 'span_id', 'room_id', 'user_id'] as const;
  for (const key of promotedKeys) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = value;
    }
  }

  const meta = payload.meta;
  if (!meta) {
    return attributes;
  }

  const correlationKeys = ['trace_id', 'span_id', 'request_id', 'dispatch_id', 'room_id', 'user_id', 'event'];
  for (const key of correlationKeys) {
    const value = meta[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = value;
    }
  }

  return attributes;
}

function emitLensTelemetryLog(
  level: LensLogLevel,
  message: string,
  attributes?: Record<string, LensAttributeValue>
): void {
  if (!telemetryLogsEnabled) {
    return;
  }

  try {
    const logger = logs.getLogger('lens.sideby.me.logs', telemetryLoggerVersion);
    logger.emit({
      severityNumber: mapSeverityNumber(level),
      severityText: level.toUpperCase(),
      body: message,
      attributes,
    });
  } catch {
    // Fail-open: log emission must never break core service behavior.
  }
}

function writeConsole(level: LensLogLevel, payload: LensStructuredLog): void {
  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

function writeAndEmit(level: LensLogLevel, args: unknown[]): void {
  const payload = buildStructuredLog(level, args);
  writeConsole(level, payload);
  emitLensTelemetryLog(level, JSON.stringify(payload), extractTelemetryAttributes(payload));
}

export function enableLensTelemetryLogs(version?: string): void {
  telemetryLoggerVersion = version?.trim() || telemetryLoggerVersion;
  telemetryLogsEnabled = true;
}

export function disableLensTelemetryLogs(): void {
  telemetryLogsEnabled = false;
}

export function logInfo(...args: unknown[]): void {
  writeAndEmit('info', args);
}

export function logWarn(...args: unknown[]): void {
  writeAndEmit('warn', args);
}

export function logError(...args: unknown[]): void {
  writeAndEmit('error', args);
}