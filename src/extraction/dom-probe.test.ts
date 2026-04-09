import { describe, expect, it, vi } from 'vitest';
import { clickLargestVideo, probeVideoElement } from './dom-probe.js';

type ProbePage = Parameters<typeof probeVideoElement>[0];
type ClickPage = Parameters<typeof clickLargestVideo>[0];

type MockFrame = {
  evaluate: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
};

function mockFrame(evaluateResult: unknown, throwOnEvaluate = false): MockFrame {
  return {
    evaluate: throwOnEvaluate
      ? vi.fn().mockRejectedValue(new Error('cross-origin'))
      : vi.fn().mockResolvedValue(evaluateResult),
    click: vi.fn().mockResolvedValue(undefined),
  };
}

function mockPage(frames: MockFrame[]): ProbePage & ClickPage {
  return {
    frames: () => frames,
    mouse: { click: vi.fn().mockResolvedValue(undefined) },
  } as unknown as ProbePage & ClickPage;
}

describe('dom-probe.ts', () => {
  describe('probeVideoElement', () => {
    it('returns area and muted state when frame.evaluate finds a match', async () => {
      const frame1 = mockFrame({ width: 250, height: 200, muted: false });
      const page = mockPage([frame1]);

      const result = await probeVideoElement(page, 'https://example.com/video.mp4');

      expect(result).toEqual({ area: 50000, muted: false });
      expect(frame1.evaluate).toHaveBeenCalledTimes(1);
    });

    it('returns null area and false muted when no video element matches', async () => {
      const frame1 = mockFrame(null);
      const page = mockPage([frame1]);

      const result = await probeVideoElement(page, 'https://example.com/video.mp4');

      expect(result).toEqual({ area: null, muted: false });
    });

    it('returns null area and false muted when frame.evaluate throws (cross-origin)', async () => {
      const frame1 = mockFrame(null, true);
      const page = mockPage([frame1]);

      const result = await probeVideoElement(page, 'https://example.com/video.mp4');

      expect(result).toEqual({ area: null, muted: false });
      expect(frame1.evaluate).toHaveBeenCalledTimes(1);
    });

    it('iterates through multiple frames if earlier ones fail or return null', async () => {
      const frame1 = mockFrame(null, true);
      const frame2 = mockFrame(null);
      const frame3 = mockFrame({ width: 100, height: 100, muted: true });
      const page = mockPage([frame1, frame2, frame3]);

      const result = await probeVideoElement(page, 'https://example.com/video.mp4');

      expect(result).toEqual({ area: 10000, muted: true });
    });
  });

  describe('clickLargestVideo', () => {
    it('returns true and clicks element when a video element exists', async () => {
      const frame1 = mockFrame({ selector: 'video[src="foo.mp4"]', area: 50000 });
      const page = mockPage([frame1]);

      const result = await clickLargestVideo(page);

      expect(result).toBe(true);
      expect(frame1.click).toHaveBeenCalledWith('video[src="foo.mp4"]', { timeout: 3000 });
    });

    it('returns false when no video elements exist', async () => {
      const frame1 = mockFrame(null);
      const page = mockPage([frame1]);

      const result = await clickLargestVideo(page);

      expect(result).toBe(false);
      expect(frame1.click).not.toHaveBeenCalled();
    });

    it('handles cross-origin frames gracefully', async () => {
      const frame1 = mockFrame(null, true);
      const frame2 = mockFrame({ selector: 'button.play', area: 1000 });
      const page = mockPage([frame1, frame2]);

      const result = await clickLargestVideo(page);

      expect(result).toBe(true);
      expect(frame1.click).not.toHaveBeenCalled();
      expect(frame2.click).toHaveBeenCalledWith('button.play', { timeout: 3000 });
    });
  });
});
