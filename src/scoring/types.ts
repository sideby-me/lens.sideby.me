/** Signals extracted from an HLS manifest */
export interface ManifestInfo {
  isLive: boolean;
  duration: number;       // total seconds (sum of segment durations)
  hasAudioTrack: boolean; // EXT-X-MEDIA TYPE=AUDIO present
  encrypted: boolean;     // EXT-X-KEY METHOD != NONE
}

/** Context needed by the scorer — computed by the caller, not the scorer */
export interface ScoreContext {
  maxObservedArea: number;    // largest video element area among all candidates
  navigationStart: number;    // timestamp (ms) of page navigation
  candidateCount: number;     // total number of candidates (for muted logic context)
}

/** A single intercepted stream candidate with pre-fetched signals */
export interface Candidate {
  url: string;
  headers: Record<string, string>;
  mediaType: 'hls' | 'mp4' | 'other';
  capturedAt: number;               // timestamp (ms) when stream was intercepted
  area: number | null;              // video element bounding box area (null if no DOM element found)
  muted: boolean;                   // video element muted state
  precededByEndedStream: boolean;   // true if another stream's EXT-X-ENDLIST confirmed before this appeared
  bitrate: number | null;           // bits/sec from variant playlist (null if unknown)
}

/** Candidate with its computed score attached */
export interface ScoredCandidate extends Candidate {
  score: number;
}
