import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

type TelemetryEnv = Partial<NodeJS.ProcessEnv>;

interface TelemetryLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
}

interface InitializeTelemetryOptions {
  env?: TelemetryEnv;
  logger?: TelemetryLogger;
  sdkFactory?: (sdk: NodeSDK) => Promise<void> | void;
}

function parseOtelHeaders(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;

  const headers = raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const index = pair.indexOf('=');
      if (index <= 0) return acc;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!key || !value) return acc;
      acc[key] = value;
      return acc;
    }, {});

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function normalizeEndpoint(endpoint?: string): string | null {
  const cleaned = endpoint?.trim();
  if (!cleaned) return null;
  return cleaned.endsWith('/') ? cleaned.slice(0, -1) : cleaned;
}

export function resolveTelemetryResourceAttributes(env: TelemetryEnv = process.env): Record<string, string> {
  return {
    'service.name': env.OTEL_SERVICE_NAME?.trim() || 'lens.sideby.me',
    'service.version': env.npm_package_version?.trim() || '0.1.0',
    'deployment.environment': env.NODE_ENV?.trim() || 'development',
  };
}

export async function initializeTelemetry(options: InitializeTelemetryOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const endpoint = normalizeEndpoint(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const logger =
    options.logger ??
    ({
      warn: (message: string, meta?: Record<string, unknown>) => {
        console.warn('[lens]', message, meta ?? {});
      },
      info: (message: string, meta?: Record<string, unknown>) => {
        console.log('[lens]', message, meta ?? {});
      },
    } as TelemetryLogger);

  if (!endpoint) {
    logger.info?.('lens telemetry bootstrap skipped: OTEL_EXPORTER_OTLP_ENDPOINT is not configured');
    return;
  }

  try {
    const headers = parseOtelHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);
    const traceUrl = `${endpoint}/v1/traces`;
    const metricUrl = `${endpoint}/v1/metrics`;
    const logUrl = `${endpoint}/v1/logs`;

    const sdk = new NodeSDK({
      resource: resourceFromAttributes(resolveTelemetryResourceAttributes(env)),
      traceExporter: new OTLPTraceExporter({
        url: traceUrl,
        headers,
      }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: metricUrl,
          headers,
        }),
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    const starter = options.sdkFactory ?? (async (instance: NodeSDK) => instance.start());
    await starter(sdk);

    logger.info?.('lens telemetry bootstrap initialized', {
      traceUrl,
      metricUrl,
      logUrl,
    });
  } catch (error) {
    logger.warn('lens telemetry bootstrap failed; continuing without exporter', {
      error: error instanceof Error ? error.message : String(error),
      endpoint,
    });
  }
}
