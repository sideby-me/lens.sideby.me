import { describe, expect, it } from 'vitest';
import { initializeTelemetry, resolveTelemetryResourceAttributes } from './bootstrap.js';

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
