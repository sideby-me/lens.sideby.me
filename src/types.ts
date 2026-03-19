export type CaptureErrorCode = 'only-ads-detected' | 'timeout' | 'no-media-found' | 'browser-launch-failed';

// Payload stored in KV and returned from capture
export interface LensPayload {
  mediaUrl: string;
  headers: Record<string, string>;
  mediaType: 'hls' | 'mp4' | 'other';
  capturedAt: number;
  expiresAt: number;
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
