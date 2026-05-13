import { spawn } from 'child_process';
import treeKill from 'tree-kill';
import { buildCaptureTelemetryPayload } from '../capture.js';
import { logInfo, logWarn } from '../telemetry/logs.js';
import type { TelemetryCorrelation } from '../types.js';

export interface YtDlpResult {
  mediaUrl: string;
  mediaType: 'hls' | 'mp4' | 'other';
  isLive?: boolean;
  headers: Record<string, string>;
}

// yt-dlp exit code 101 means MaxDownloadsReached — raised after successfully
// processing --max-downloads N items. With --max-downloads 1 this is the
// normal termination path: JSON has already been written to stdout.
// Treat it the same as exit 0 — attempt to parse stdout before giving up.
const YTDLP_MAX_DOWNLOADS_REACHED = 101;

function logYtdlpTelemetry(
  level: 'info' | 'warn' | 'error',
  event: string,
  correlation: TelemetryCorrelation = {},
  payload: Record<string, unknown> = {}
): void {
  const line = JSON.stringify(buildCaptureTelemetryPayload(event, correlation, payload));
  if (level === 'error') {
    // logError not imported — only info and warn are needed; fallback to warn for safety
    logWarn(line);
    return;
  }
  if (level === 'warn') {
    logWarn(line);
    return;
  }
  logInfo(line);
}

function parseYtdlpOutput(json: string): YtDlpResult | null {
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    const url = data['url'] as string | undefined;
    if (!url) return null;

    const protocol = (data['protocol'] as string | undefined) ?? '';
    const ext = (data['ext'] as string | undefined) ?? '';
    const liveStatus = data['live_status'] as string | undefined;
    const rawHeaders = (data['http_headers'] as Record<string, string> | undefined) ?? {};

    let mediaType: 'hls' | 'mp4' | 'other';
    if (protocol === 'm3u8' || protocol === 'm3u8_native') {
      mediaType = 'hls';
    } else if (ext === 'mp4' || ext === 'm4v') {
      mediaType = 'mp4';
    } else {
      mediaType = 'other';
    }

    return {
      mediaUrl: url,
      mediaType,
      isLive: liveStatus === 'is_live' ? true : undefined,
      headers: rawHeaders,
    };
  } catch {
    return null;
  }
}

export async function tryYtdlp(
  url: string,
  correlation: TelemetryCorrelation,
  signal: AbortSignal,
  proxy?: string
): Promise<YtDlpResult | null> {
  const binary = process.env.LENS_YTDLP_PATH ?? 'yt-dlp';
  const timeoutMs = Number(process.env.LENS_YTDLP_TIMEOUT_MS ?? 8_000);
  const attemptStart = Date.now();

  logYtdlpTelemetry('info', 'ytdlp_attempt', correlation, { url });

  const proc = spawn(
    binary,
    [
      '--dump-json',
      '--no-playlist',
      '--playlist-items',
      '1',
      '--max-downloads',
      '1',
      '--no-warnings',
      '--quiet',
      '--skip-download',
      '--socket-timeout',
      '5',
      '--retries',
      '2',
      // curl-cffi TLS impersonation — makes the TLS client-hello look like Chrome,
      // bypassing WAF fingerprint blocks that cause ConnectionResetError
      '--impersonate',
      'chrome',
      ...(proxy ? ['--proxy', proxy] : []),
      // best* includes video-only streams; best requires combined A+V
      '-f',
      'best*[ext=mp4]/best*[ext=webm]/best*',
      url,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const chunks: string[] = [];
  const stderrChunks: string[] = [];

  proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()));

  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    if (proc.pid) treeKill(proc.pid, 'SIGTERM');
    setTimeout(() => {
      if (proc.pid) treeKill(proc.pid, 'SIGKILL');
    }, 2_000);
  }, timeoutMs);

  // PROC-04: parent AbortSignal also kills
  function abortHandler() {
    clearTimeout(killTimer);
    if (proc.pid) treeKill(proc.pid, 'SIGTERM');
  }
  signal.addEventListener('abort', abortHandler, { once: true });

  return new Promise<YtDlpResult | null>(resolve => {
    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(killTimer);
      signal.removeEventListener('abort', abortHandler);
      // D-08: ENOENT gets its own event name
      if (err.code === 'ENOENT') {
        logYtdlpTelemetry('warn', 'ytdlp_not_installed', correlation, {});
      } else {
        logYtdlpTelemetry('warn', 'ytdlp_failure', correlation, {
          reason: err.message,
        });
      }
      resolve(null);
    });

    proc.on('close', (code: number | null) => {
      clearTimeout(killTimer);
      signal.removeEventListener('abort', abortHandler); // Pitfall 5: prevent stale listener

      if (timedOut) {
        logYtdlpTelemetry('warn', 'ytdlp_timeout', correlation, { url });
        resolve(null);
        return;
      }

      // Exit code 101 (MaxDownloadsReached) is expected when --max-downloads 1
      // is set: yt-dlp writes the JSON to stdout then exits 101 after the first
      // item. Fall through to stdout parsing so we don't discard a valid result.
      const isSuccess = code === 0 || code === YTDLP_MAX_DOWNLOADS_REACHED;

      if (!isSuccess) {
        logYtdlpTelemetry('warn', 'ytdlp_failure', correlation, {
          reason: 'non-zero exit',
          exitCode: code,
          stderr: stderrChunks.join('').slice(0, 512),
        });
        resolve(null);
        return;
      }

      // Pitfall 4: collect then parse — never parse mid-chunk
      const raw = chunks.join('');
      const result = parseYtdlpOutput(raw);
      if (!result) {
        logYtdlpTelemetry('warn', 'ytdlp_failure', correlation, {
          reason: 'json-parse-failed',
          exitCode: code,
        });
        resolve(null);
        return;
      }

      logYtdlpTelemetry('info', 'ytdlp_success', correlation, {
        mediaType: result.mediaType,
        latencyMs: Date.now() - attemptStart,
      });
      resolve(result);
    });
  });
}
