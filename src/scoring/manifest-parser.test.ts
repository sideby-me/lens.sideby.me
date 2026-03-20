import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VOD_LONG,
  VOD_SHORT,
  VOD_MEDIUM,
  LIVE_EVENT,
  LIVE_AMBIGUOUS,
  ENCRYPTED,
  VOD_DELAYED_ENDLIST,
} from './fixtures/manifests.js';

// Mock global fetch before importing the module under test
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import AFTER mocking so the module picks up the stubbed global
const { fetchAndParseManifest } = await import('./manifest-parser.js');

function mockFetchResponse(body: string, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------

describe('manifest parsing', () => {
  it('VOD_LONG: duration=190, isLive=false, hasAudioTrack=true, encrypted=false', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(VOD_LONG));
    const result = await fetchAndParseManifest('https://example.com/vod-long.m3u8', {});
    expect(result).not.toBeNull();
    expect(result!.duration).toBe(190);
    expect(result!.isLive).toBe(false);
    expect(result!.hasAudioTrack).toBe(true);
    expect(result!.encrypted).toBe(false);
  });

  it('VOD_SHORT: duration=50, isLive=false, hasAudioTrack=false, encrypted=false', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(VOD_SHORT));
    const result = await fetchAndParseManifest('https://example.com/vod-short.m3u8', {});
    expect(result).not.toBeNull();
    expect(result!.duration).toBe(50);
    expect(result!.isLive).toBe(false);
    expect(result!.hasAudioTrack).toBe(false);
    expect(result!.encrypted).toBe(false);
  });

  it('VOD_MEDIUM: duration=120, isLive=false, hasAudioTrack=false, encrypted=false', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(VOD_MEDIUM));
    const result = await fetchAndParseManifest('https://example.com/vod-medium.m3u8', {});
    expect(result).not.toBeNull();
    expect(result!.duration).toBe(120);
    expect(result!.isLive).toBe(false);
    expect(result!.hasAudioTrack).toBe(false);
    expect(result!.encrypted).toBe(false);
  });

  it('ENCRYPTED: duration=30, isLive=false, hasAudioTrack=false, encrypted=true', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(ENCRYPTED));
    const result = await fetchAndParseManifest('https://example.com/encrypted.m3u8', {});
    expect(result).not.toBeNull();
    expect(result!.duration).toBe(30);
    expect(result!.isLive).toBe(false);
    expect(result!.hasAudioTrack).toBe(false);
    expect(result!.encrypted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Live detection - Tier 1 (definitive, no re-fetch)
// ---------------------------------------------------------------------------

describe('live detection - Tier 1', () => {
  it('LIVE_EVENT (EXT-X-PLAYLIST-TYPE:EVENT) -> isLive=true without re-fetch', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(LIVE_EVENT));
    const result = await fetchAndParseManifest('https://example.com/live-event.m3u8', {});
    expect(result).not.toBeNull();
    expect(result!.isLive).toBe(true);
    // Tier 1: only one fetch call (no re-fetch)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('VOD_LONG (EXT-X-PLAYLIST-TYPE:VOD) -> isLive=false without re-fetch', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(VOD_LONG));
    const result = await fetchAndParseManifest('https://example.com/vod-long.m3u8', {});
    expect(result).not.toBeNull();
    expect(result!.isLive).toBe(false);
    // Tier 1: only one fetch call (no re-fetch)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('VOD with endList but no playlistType -> isLive=false without re-fetch', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(VOD_DELAYED_ENDLIST));
    const result = await fetchAndParseManifest('https://example.com/vod.m3u8', {});
    expect(result).not.toBeNull();
    expect(result!.isLive).toBe(false);
    // endList is true => complete VOD, no re-fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Live detection - Tier 2 (ambiguous, re-fetch required)
// ---------------------------------------------------------------------------

describe('live detection - Tier 2', () => {
  it('LIVE_AMBIGUOUS first fetch + LIVE_AMBIGUOUS re-fetch -> isLive=true', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(LIVE_AMBIGUOUS))
      .mockResolvedValueOnce(mockFetchResponse(LIVE_AMBIGUOUS));
    const promise = fetchAndParseManifest('https://example.com/live.m3u8', {});
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.isLive).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('LIVE_AMBIGUOUS first fetch + VOD_DELAYED_ENDLIST re-fetch -> isLive=false', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(LIVE_AMBIGUOUS))
      .mockResolvedValueOnce(mockFetchResponse(VOD_DELAYED_ENDLIST));
    const promise = fetchAndParseManifest('https://example.com/live.m3u8', {});
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.isLive).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('LIVE_AMBIGUOUS first fetch + re-fetch network error -> assumes isLive=true', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(LIVE_AMBIGUOUS))
      .mockRejectedValueOnce(new Error('Network failure'));
    const promise = fetchAndParseManifest('https://example.com/live.m3u8', {});
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.isLive).toBe(true);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Audio detection
// ---------------------------------------------------------------------------

describe('audio detection', () => {
  it('VOD_LONG (has EXT-X-MEDIA TYPE=AUDIO) -> hasAudioTrack=true', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(VOD_LONG));
    const result = await fetchAndParseManifest('https://example.com/vod-long.m3u8', {});
    expect(result!.hasAudioTrack).toBe(true);
  });

  it('VOD_SHORT (no EXT-X-MEDIA) -> hasAudioTrack=false', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(VOD_SHORT));
    const result = await fetchAndParseManifest('https://example.com/vod-short.m3u8', {});
    expect(result!.hasAudioTrack).toBe(false);
  });

  it('LIVE_EVENT (no EXT-X-MEDIA) -> hasAudioTrack=false', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(LIVE_EVENT));
    const result = await fetchAndParseManifest('https://example.com/live-event.m3u8', {});
    expect(result!.hasAudioTrack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Encryption detection
// ---------------------------------------------------------------------------

describe('encryption detection', () => {
  it('ENCRYPTED (EXT-X-KEY:METHOD=AES-128) -> encrypted=true', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(ENCRYPTED));
    const result = await fetchAndParseManifest('https://example.com/encrypted.m3u8', {});
    expect(result!.encrypted).toBe(true);
  });

  it('VOD_LONG (no EXT-X-KEY) -> encrypted=false', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(VOD_LONG));
    const result = await fetchAndParseManifest('https://example.com/vod-long.m3u8', {});
    expect(result!.encrypted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('network error on fetch -> returns null (no throw)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    const result = await fetchAndParseManifest('https://example.com/stream.m3u8', {});
    expect(result).toBeNull();
  });

  it('404 response -> returns null', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse('Not Found', 404));
    const result = await fetchAndParseManifest('https://example.com/stream.m3u8', {});
    expect(result).toBeNull();
  });

  it('empty manifest body -> returns null', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(''));
    const result = await fetchAndParseManifest('https://example.com/stream.m3u8', {});
    expect(result).toBeNull();
  });

  it('invalid (non-HLS) manifest body -> returns null', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse('<html>error page</html>'));
    const result = await fetchAndParseManifest('https://example.com/stream.m3u8', {});
    expect(result).toBeNull();
  });

  it('passes headers to fetch', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(VOD_SHORT));
    const headers = { Authorization: 'Bearer token123', Cookie: 'session=abc' };
    await fetchAndParseManifest('https://example.com/stream.m3u8', headers);
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/stream.m3u8', { headers });
  });
});
