import { describe, it, expect } from 'vitest';
import type { Candidate, ScoredCandidate, ManifestInfo, ScoreContext } from './types.js';
import type { LensPayload } from '../types.js';

describe('LensPayload type — required and optional fields', () => {
  it('an object with all required fields (including v1.1 fields) is assignable', () => {
    const payload: LensPayload = {
      mediaUrl: 'https://example.com/stream.m3u8',
      headers: {},
      mediaType: 'hls',
      capturedAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
      lowConfidence: false,
      ambiguous: false,
      alternatives: [],
    };
    expect(payload).toBeDefined();
  });

  it('an object with encrypted: true, isLive: true, and v1.1 fields is assignable to LensPayload', () => {
    const payload: LensPayload = {
      mediaUrl: 'https://example.com/stream.m3u8',
      headers: {},
      mediaType: 'hls',
      capturedAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
      encrypted: true,
      isLive: true,
      lowConfidence: false,
      ambiguous: false,
      alternatives: [],
    };
    expect(payload.encrypted).toBe(true);
    expect(payload.isLive).toBe(true);
  });
});

describe('Scoring types — runtime object creation', () => {
  it('ManifestInfo object can be created', () => {
    const info: ManifestInfo = {
      isLive: false,
      duration: 190,
      hasAudioTrack: true,
      encrypted: false,
    };
    expect(info).toBeDefined();
  });

  it('ScoreContext object can be created', () => {
    const ctx: ScoreContext = {
      maxObservedArea: 1920 * 1080,
      navigationStart: Date.now(),
      candidateCount: 3,
    };
    expect(ctx).toBeDefined();
  });

  it('Candidate object can be created', () => {
    const candidate: Candidate = {
      url: 'https://example.com/stream.m3u8',
      headers: { Authorization: 'Bearer token' },
      mediaType: 'hls',
      capturedAt: Date.now(),
      area: 1920 * 1080,
      muted: false,
      precededByEndedStream: false,
      bitrate: 5_000_000,
    };
    expect(candidate).toBeDefined();
  });

  it('ScoredCandidate object can be created (extends Candidate with score)', () => {
    const scored: ScoredCandidate = {
      url: 'https://example.com/stream.m3u8',
      headers: {},
      mediaType: 'mp4',
      capturedAt: Date.now(),
      area: null,
      muted: true,
      precededByEndedStream: true,
      bitrate: null,
      score: 42,
    };
    expect(scored.score).toBe(42);
  });
});
