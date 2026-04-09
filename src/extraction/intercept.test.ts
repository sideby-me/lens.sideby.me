import { describe, expect, it, vi } from 'vitest';
import { classifyMedia, isAdUrl, isMediaUrl, setupInterception } from './intercept.js';

type SetupOptions = Parameters<typeof setupInterception>[0];
type InterceptionContext = SetupOptions['context'];
type InterceptionPage = SetupOptions['page'];
type Handler = (...args: unknown[]) => unknown;

function mockContext() {
  const handlers: Record<string, Handler[]> = {};
  return {
    route: vi.fn().mockResolvedValue(undefined),
    unroute: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, handler: Handler) => {
      (handlers[event] ??= []).push(handler);
    }),
    off: vi.fn(),
    _handlers: handlers,
  };
}

function mockPage(): InterceptionPage {
  return {} as InterceptionPage;
}

function mockAbortSignal(): AbortSignal {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    aborted: false,
    reason: undefined,
    dispatchEvent: vi.fn(),
    onabort: null,
    throwIfAborted: vi.fn(),
  } as unknown as AbortSignal;
}

describe('intercept.ts', () => {
  it('identifies ad URLs correctly', () => {
    expect(isAdUrl('https://doubleclick.net/ads/video')).toBe(true);
    expect(isAdUrl('https://cdn.example.com/video.m3u8')).toBe(false);
  });

  it('classifies media correctly', () => {
    expect(classifyMedia('https://x.com/a.m3u8')).toBe('hls');
    expect(classifyMedia('https://x.com/a.mp4')).toBe('mp4');
  });

  it('identifies media URLs correctly', () => {
    expect(isMediaUrl('https://x.com/a.m3u8')).toBe(true);
    expect(isMediaUrl('https://x.com/notmedia.txt')).toBe(false);
  });

  it('calls onCandidate when a non-ad media response fires', async () => {
    const context = mockContext();
    const page = mockPage();
    const abortSignal = mockAbortSignal();
    const onCandidate = vi.fn();

    const cleanup = setupInterception({
      context: context as unknown as InterceptionContext,
      page,
      abortSignal,
      onCandidate,
    });

    const responseHandler = context._handlers['response']?.[0];
    expect(responseHandler).toBeDefined();

    await responseHandler?.({
      url: () => 'https://cdn.example.com/video.m3u8',
      headers: () => ({ 'content-type': 'application/vnd.apple.mpegurl' }),
      frame: () => ({ url: () => 'https://example.com' }),
    });

    expect(onCandidate).toHaveBeenCalledTimes(1);
    expect(onCandidate.mock.calls[0][0]).toMatchObject({
      url: 'https://cdn.example.com/video.m3u8',
      mediaType: 'hls',
      frameUrl: 'https://example.com',
    });
    expect(onCandidate.mock.calls[0][0].capturedAt).toBeTypeOf('number');

    cleanup();
  });

  it('does NOT call onCandidate for ad URLs', async () => {
    const context = mockContext();
    const page = mockPage();
    const abortSignal = mockAbortSignal();
    const onCandidate = vi.fn();

    setupInterception({
      context: context as unknown as InterceptionContext,
      page,
      abortSignal,
      onCandidate,
    });

    const responseHandler = context._handlers['response']?.[0];
    expect(responseHandler).toBeDefined();

    await responseHandler?.({
      url: () => 'https://doubleclick.net/ads/video.mp4',
      headers: () => ({ 'content-type': 'video/mp4' }),
      frame: () => ({ url: () => 'https://example.com' }),
    });

    expect(onCandidate).not.toHaveBeenCalled();
  });

  it('returned cleanup function removes handlers', () => {
    const context = mockContext();
    const page = mockPage();
    const abortSignal = mockAbortSignal();
    const onCandidate = vi.fn();

    const cleanup = setupInterception({
      context: context as unknown as InterceptionContext,
      page,
      abortSignal,
      onCandidate,
    });

    cleanup();

    expect(context.unroute).toHaveBeenCalled();
    expect(context.off).toHaveBeenCalledWith('response', expect.any(Function));
  });
});
