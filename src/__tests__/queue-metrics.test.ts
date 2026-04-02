import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { metrics } from '@opentelemetry/api';

describe('queue metrics', () => {
  let mockMeter: ReturnType<typeof metrics.getMeter>;
  let mockGauges: Map<string, ReturnType<typeof mockMeter.createObservableGauge>>;

  beforeEach(() => {
    mockGauges = new Map();
    mockMeter = {
      createCounter: vi.fn(),
      createHistogram: vi.fn(),
      createUpDownCounter: vi.fn(),
      createObservableGauge: vi.fn((name: string) => {
        const gauge = {
          addCallback: vi.fn(),
          removeCallback: vi.fn(),
        };
        mockGauges.set(name, gauge);
        return gauge;
      }),
    } as unknown as typeof mockMeter;

    vi.spyOn(metrics, 'getMeter').mockReturnValue(mockMeter);
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('gauge creation', () => {
    it('should create queue_depth_waiting gauge with label queue_name', async () => {
      const { createQueueMetrics } = await import('../queue-metrics.js');
      createQueueMetrics();

      expect(mockMeter.createObservableGauge).toHaveBeenCalledWith(
        'queue_depth_waiting',
        expect.objectContaining({
          description: expect.any(String),
          unit: '{job}',
        })
      );
    });

    it('should create queue_depth_active gauge with label queue_name', async () => {
      const { createQueueMetrics } = await import('../queue-metrics.js');
      createQueueMetrics();

      expect(mockMeter.createObservableGauge).toHaveBeenCalledWith(
        'queue_depth_active',
        expect.objectContaining({
          description: expect.any(String),
          unit: '{job}',
        })
      );
    });

    it('should create queue_depth_failed gauge with label queue_name', async () => {
      const { createQueueMetrics } = await import('../queue-metrics.js');
      createQueueMetrics();

      expect(mockMeter.createObservableGauge).toHaveBeenCalledWith(
        'queue_depth_failed',
        expect.objectContaining({
          description: expect.any(String),
          unit: '{job}',
        })
      );
    });

    it('should create queue_wait_age_ms gauge with label queue_name', async () => {
      const { createQueueMetrics } = await import('../queue-metrics.js');
      createQueueMetrics();

      expect(mockMeter.createObservableGauge).toHaveBeenCalledWith(
        'queue_wait_age_ms',
        expect.objectContaining({
          description: expect.any(String),
          unit: 'ms',
        })
      );
    });
  });

  describe('updateQueueMetrics', () => {
    it('should call queue.getJobCounts and update gauges', async () => {
      const { createQueueMetrics, updateQueueMetrics } = await import('../queue-metrics.js');
      createQueueMetrics();

      const mockQueue = {
        getJobCounts: vi.fn().mockResolvedValue({
          waiting: 5,
          active: 2,
          failed: 1,
        }),
        getWaiting: vi.fn().mockResolvedValue([]),
      } as unknown as Parameters<typeof updateQueueMetrics>[0];

      await updateQueueMetrics(mockQueue, 'capture');

      expect(mockQueue.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'failed');
    });

    it('should not propagate errors when queue throws', async () => {
      const { createQueueMetrics, updateQueueMetrics } = await import('../queue-metrics.js');
      createQueueMetrics();

      const mockQueue = {
        getJobCounts: vi.fn().mockRejectedValue(new Error('Redis connection error')),
        getWaiting: vi.fn().mockRejectedValue(new Error('Redis connection error')),
      } as unknown as Parameters<typeof updateQueueMetrics>[0];

      // Should not throw
      await expect(updateQueueMetrics(mockQueue, 'capture')).resolves.not.toThrow();
    });
  });

  describe('startQueueMetricsPolling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return a stop function that clears interval', async () => {
      const { createQueueMetrics, startQueueMetricsPolling } = await import('../queue-metrics.js');
      createQueueMetrics();

      const mockQueue = {
        getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, failed: 0 }),
        getWaiting: vi.fn().mockResolvedValue([]),
      } as unknown as Parameters<typeof startQueueMetricsPolling>[0];

      const stop = startQueueMetricsPolling(mockQueue, 'capture', 15000);

      expect(typeof stop).toBe('function');

      // Clean up
      stop();
    });

    it('should poll at specified interval', async () => {
      const { createQueueMetrics, startQueueMetricsPolling } = await import('../queue-metrics.js');
      createQueueMetrics();

      const mockQueue = {
        getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, failed: 0 }),
        getWaiting: vi.fn().mockResolvedValue([]),
      } as unknown as Parameters<typeof startQueueMetricsPolling>[0];

      startQueueMetricsPolling(mockQueue, 'capture', 15000);

      // Initial call happens immediately
      expect(mockQueue.getJobCounts).toHaveBeenCalledTimes(1);

      // Advance past interval
      await vi.advanceTimersByTimeAsync(15000);
      expect(mockQueue.getJobCounts).toHaveBeenCalledTimes(2);

      // Advance again
      await vi.advanceTimersByTimeAsync(15000);
      expect(mockQueue.getJobCounts).toHaveBeenCalledTimes(3);
    });
  });
});
