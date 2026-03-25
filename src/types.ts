export type CaptureErrorCode = 'only-ads-detected' | 'timeout' | 'no-media-found' | 'browser-launch-failed';

// LENS-03: Alternative stream entry for ambiguous/low-confidence payloads
export interface AlternativeEntry {
  mediaUrl: string;
  mediaType: 'hls' | 'mp4' | 'other';
  durationSec: number | null;
  bitrate: number | null;
  isLive: boolean | undefined;
  headers: Record<string, string>;
}

// Payload stored in KV and returned from capture
export interface LensPayload {
  mediaUrl: string;
  headers: Record<string, string>;
  mediaType: 'hls' | 'mp4' | 'other';
  capturedAt: number;
  expiresAt: number;
  encrypted?: boolean;   // SIG-08: EXT-X-KEY METHOD != NONE
  isLive?: boolean;      // SIG-05: live stream detection result
  lowConfidence: boolean;   // LENS-01: winner score below MIN_MEANINGFUL_SCORE
  ambiguous: boolean;       // LENS-02: winner/runner-up gap below threshold
  alternatives: AlternativeEntry[];  // LENS-03: sorted non-winner candidates
  ipBound?: boolean;     // token path encodes the capture IP — pipe must relay through home server
}

// Job data queued in BullMQ
export interface LensJob {
  url: string;
  uuid: string;
}

// Result returned from a successful capture
export interface CaptureResult {
  uuid: string;
  payload: LensPayload;
}

// SSE event sent from Lens to the watch server
export interface SSEEvent {
  type: 'status' | 'done' | 'error';
  data: Record<string, unknown>;
}

// Capture error with typed code
export interface CaptureError {
  code: CaptureErrorCode;
  message: string;
}
