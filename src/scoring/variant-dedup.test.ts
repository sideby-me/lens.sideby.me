import { describe, it, expect } from 'vitest';
import { deduplicateVariants } from './variant-dedup.js';
import type { Candidate } from './types.js';

describe('variant-dedup', () => {
  it('deduplicates multiple variants sharing same base URL, keeping highest bitrate', () => {
    const candidates: Candidate[] = [
      { url: 'https://cdn.example.com/master.m3u8/720p', headers: {}, mediaType: 'hls', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: 2000000 },
      { url: 'https://cdn.example.com/master.m3u8/1080p', headers: {}, mediaType: 'hls', capturedAt: 1005, area: null, muted: false, precededByEndedStream: false, bitrate: 5000000 }
    ];
    
    const result = deduplicateVariants(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://cdn.example.com/master.m3u8/1080p');
  });

  it('keeps candidates with different base URLs', () => {
    const candidates: Candidate[] = [
      { url: 'https://cdn.example.com/video.m3u8', headers: {}, mediaType: 'hls', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: null },
      { url: 'https://other.com/stream.m3u8', headers: {}, mediaType: 'hls', capturedAt: 1005, area: null, muted: false, precededByEndedStream: false, bitrate: null }
    ];
    
    const result = deduplicateVariants(candidates);
    expect(result).toHaveLength(2);
  });

  it('tie-breaks by earlier capturedAt when bitrates are missing', () => {
    const candidates: Candidate[] = [
      { url: 'https://cdn.example.com/master.m3u8/720p', headers: {}, mediaType: 'hls', capturedAt: 2000, area: null, muted: false, precededByEndedStream: false, bitrate: null },
      { url: 'https://cdn.example.com/master.m3u8/1080p', headers: {}, mediaType: 'hls', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: null }
    ];
    
    const result = deduplicateVariants(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://cdn.example.com/master.m3u8/1080p');
  });

  it('does not touch mp4 files', () => {
    const candidates: Candidate[] = [
      { url: 'https://cdn.example.com/master.mp4/720p', headers: {}, mediaType: 'mp4', capturedAt: 1000, area: null, muted: false, precededByEndedStream: false, bitrate: null },
      { url: 'https://cdn.example.com/master.mp4/1080p', headers: {}, mediaType: 'mp4', capturedAt: 1005, area: null, muted: false, precededByEndedStream: false, bitrate: null }
    ];
    
    const result = deduplicateVariants(candidates);
    expect(result).toHaveLength(2);
  });

  it('handles empty array', () => {
    const result = deduplicateVariants([]);
    expect(result).toHaveLength(0);
  });
});
