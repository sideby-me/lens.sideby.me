import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { metrics, Counter, Histogram } from '@opentelemetry/api';

describe('capture metrics', () => {
  let mockMeter: ReturnType<typeof metrics.getMeter>;
  let mockCounters: Map<string, Counter>;
  let mockHistograms: Map<string, Histogram>;

  beforeEach(() => {
    mockCounters = new Map();
    mockHistograms = new Map();
    mockMeter = {
      createCounter: vi.fn((name: string) => {
        const counter = {
          add: vi.fn(),
        } as unknown as Counter;
        mockCounters.set(name, counter);
        return counter;
      }),
      createHistogram: vi.fn((name: string) => {
        const histogram = {
          record: vi.fn(),
        } as unknown as Histogram;
        mockHistograms.set(name, histogram);
        return histogram;
      }),
      createUpDownCounter: vi.fn(),
      createObservableGauge: vi.fn(),
    } as unknown as typeof mockMeter;

    vi.spyOn(metrics, 'getMeter').mockReturnValue(mockMeter);
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('instrument creation', () => {
    it('should create capture_requests_total counter with media_type and outcome labels', async () => {
      const { createCaptureMetrics } = await import('../metrics.js');
      createCaptureMetrics();

      expect(mockMeter.createCounter).toHaveBeenCalledWith(
        'capture_requests_total',
        expect.objectContaining({
          description: expect.any(String),
          unit: '{request}',
        })
      );
    });

    it('should create capture_latency_ms histogram with media_type and outcome labels', async () => {
      const { createCaptureMetrics } = await import('../metrics.js');
      createCaptureMetrics();

      expect(mockMeter.createHistogram).toHaveBeenCalledWith(
        'capture_latency_ms',
        expect.objectContaining({
          description: expect.any(String),
          unit: 'ms',
        })
      );
    });

    it('should create capture_errors_total counter with media_type and error_type labels', async () => {
      const { createCaptureMetrics } = await import('../metrics.js');
      createCaptureMetrics();

      expect(mockMeter.createCounter).toHaveBeenCalledWith(
        'capture_errors_total',
        expect.objectContaining({
          description: expect.any(String),
          unit: '{error}',
        })
      );
    });
  });

  describe('recordCaptureStart', () => {
    it('should return a stop function that records latency', async () => {
      const { createCaptureMetrics, recordCaptureStart } = await import('../metrics.js');
      createCaptureMetrics();

      const stopTimer = recordCaptureStart('hls');

      // Simulate some passage of time
      await new Promise(resolve => setTimeout(resolve, 10));

      const latencyMs = stopTimer();

      expect(typeof latencyMs).toBe('number');
      expect(latencyMs).toBeGreaterThanOrEqual(10);
      expect(mockHistograms.get('capture_latency_ms')?.record).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({
          media_type: 'hls',
          outcome: 'success',
        })
      );
    });

    it('should not throw when metrics recording fails', async () => {
      const { createCaptureMetrics, recordCaptureStart } = await import('../metrics.js');
      createCaptureMetrics();

      // Make the histogram throw
      const histogram = mockHistograms.get('capture_latency_ms');
      if (histogram) {
        (histogram as unknown as { record: ReturnType<typeof vi.fn> }).record.mockImplementation(() => {
          throw new Error('metrics backend unavailable');
        });
      }

      const stopTimer = recordCaptureStart('hls');

      // Should not throw even when the underlying record throws
      expect(() => stopTimer()).not.toThrow();
    });
  });

  describe('recordCaptureOutcome', () => {
    it('should increment capture_requests_total counter with correct labels', async () => {
      const { createCaptureMetrics, recordCaptureOutcome } = await import('../metrics.js');
      createCaptureMetrics();

      recordCaptureOutcome('hls', 'success');

      expect(mockCounters.get('capture_requests_total')?.add).toHaveBeenCalledWith(1, {
        media_type: 'hls',
        outcome: 'success',
      });
    });

    it('should accept bounded outcome values', async () => {
      const { createCaptureMetrics, recordCaptureOutcome } = await import('../metrics.js');
      createCaptureMetrics();

      // Test all valid outcome values
      const outcomes: Array<'success' | 'failure' | 'timeout'> = ['success', 'failure', 'timeout'];

      for (const outcome of outcomes) {
        recordCaptureOutcome('hls', outcome);
        expect(mockCounters.get('capture_requests_total')?.add).toHaveBeenCalledWith(1, {
          media_type: 'hls',
          outcome,
        });
      }
    });

    it('should not throw when counter recording fails', async () => {
      const { createCaptureMetrics, recordCaptureOutcome } = await import('../metrics.js');
      createCaptureMetrics();

      const counter = mockCounters.get('capture_requests_total');
      if (counter) {
        (counter as unknown as { add: ReturnType<typeof vi.fn> }).add.mockImplementation(() => {
          throw new Error('metrics backend unavailable');
        });
      }

      expect(() => recordCaptureOutcome('hls', 'success')).not.toThrow();
    });
  });

  describe('recordCaptureError', () => {
    it('should increment capture_errors_total counter with correct labels', async () => {
      const { createCaptureMetrics, recordCaptureError } = await import('../metrics.js');
      createCaptureMetrics();

      recordCaptureError('hls', 'capture-failure');

      expect(mockCounters.get('capture_errors_total')?.add).toHaveBeenCalledWith(1, {
        media_type: 'hls',
        error_type: 'capture-failure',
      });
    });

    it('should accept bounded error_type values', async () => {
      const { createCaptureMetrics, recordCaptureError } = await import('../metrics.js');
      createCaptureMetrics();

      // Test all valid error_type values
      const errorTypes: Array<'capture-failure' | 'timeout' | 'network-error' | 'manifest-error'> = ['capture-failure', 'timeout', 'network-error', 'manifest-error'];

      for (const errorType of errorTypes) {
        recordCaptureError('hls', errorType);
        expect(mockCounters.get('capture_errors_total')?.add).toHaveBeenCalledWith(1, {
          media_type: 'hls',
          error_type: errorType,
        });
      }
    });

    it('should not throw when error counter recording fails', async () => {
      const { createCaptureMetrics, recordCaptureError } = await import('../metrics.js');
      createCaptureMetrics();

      const counter = mockCounters.get('capture_errors_total');
      if (counter) {
        (counter as unknown as { add: ReturnType<typeof vi.fn> }).add.mockImplementation(() => {
          throw new Error('metrics backend unavailable');
        });
      }

      expect(() => recordCaptureError('hls', 'capture-failure')).not.toThrow();
    });
  });
});
