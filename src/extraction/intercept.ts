import type { BrowserContext, Page, Route } from 'patchright';

// Ad network domains and path patterns to let through (not abort)
const AD_DOMAINS = ['doubleclick.net', 'googlesyndication.com', '2mdn.net', 'ads.youtube.com', 'imasdk.googleapis.com'];

const AD_PATHS = ['/ads/', '/preroll/', '/vast/', '/vmap/'];

// Check if a URL belongs to an ad network
export function isAdUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const search = parsed.search.toLowerCase();

    // Domain match
    if (AD_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
      return true;
    }

    // Path match
    if (AD_PATHS.some(p => pathname.includes(p))) return true;

    // Query match
    if (search.includes('vast') || search.includes('vmap')) return true;

    // XML endpoint (VAST/VMAP manifests)
    if (pathname.endsWith('.xml')) return true;

    return false;
  } catch {
    return false;
  }
}

// Media file extensions to detect
const MEDIA_EXTENSIONS = ['.m3u8', '.mp4', '.ts', '.m4s', '.webm'];

// Content types that indicate media
const MEDIA_CONTENT_TYPES = ['video/', 'audio/', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'];

export interface CapturedMedia {
  url: string;
  headers: Record<string, string>;
  mediaType: 'hls' | 'mp4' | 'other';
}

/** Raw candidate from network interception — no DOM signals yet */
export interface RawCandidate {
  url: string;
  headers: Record<string, string>;
  mediaType: 'hls' | 'mp4' | 'other';
  capturedAt: number;
  frameUrl: string | null; // frame.url() for cross-origin correlation
}

export interface InterceptionOptions {
  context: BrowserContext;
  page: Page;
  abortSignal: AbortSignal;
  onCandidate: (candidate: RawCandidate) => void;
}

// Determine media type from URL and content type
export function classifyMedia(url: string, contentType?: string): 'hls' | 'mp4' | 'other' {
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8') || contentType?.includes('mpegurl')) return 'hls';
  if (lower.includes('.mp4') || lower.includes('.m4v')) return 'mp4';
  return 'other';
}

// Check if a URL or content type represents media content
export function isMediaUrl(url: string, contentType?: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();

    // Extension match
    if (MEDIA_EXTENSIONS.some(ext => pathname.includes(ext))) return true;

    // Content-Type match
    if (contentType) {
      const ct = contentType.toLowerCase();
      if (MEDIA_CONTENT_TYPES.some(m => ct.includes(m))) return true;
    }
  } catch {
    // ignore invalid URLs
  }

  return false;
}

// Check if URL looks like HLS based on extension alone (for route handler, before response)
export function isHlsUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.includes('.m3u8');
  } catch {
    return false;
  }
}

// Set up network interception on a browser context
export function setupInterception(opts: InterceptionOptions): () => void {
  // Captured request headers keyed by URL (set during route handler, read during response handler)
  const requestHeadersByUrl = new Map<string, Record<string, string>>();

  function cleanup() {
    opts.context.unroute('**', routeHandler).catch(() => {});
    opts.context.off('response', responseHandler);
  }

  // Route handler: intercept every request
  async function routeHandler(route: Route) {
    const request = route.request();
    const url = request.url();

    if (!isAdUrl(url)) {
      // Capture request headers for later use in response handler
      try {
        requestHeadersByUrl.set(url, request.headers());
      } catch {
        // ignore
      }
    }

    // Always continue
    route.continue().catch(() => {});
  }

  // Response handler: inspect content-type for media classification
  async function responseHandler(response: { url(): string; headers(): Record<string, string>; frame(): any }) {
    const url = response.url();
    const contentType = response.headers()['content-type'] ?? '';

    if (isAdUrl(url)) return;
    if (!isMediaUrl(url, contentType)) return;

    const reqHeaders = requestHeadersByUrl.get(url) ?? {};
    const mediaType = classifyMedia(url, contentType);

    let frameUrl: string | null = null;
    try {
      frameUrl = response.frame()?.url() ?? null;
    } catch {
      // cross-origin frame may throw
    }

    opts.onCandidate({
      url,
      headers: reqHeaders,
      mediaType,
      capturedAt: Date.now(),
      frameUrl,
    });
  }

  // Register handlers
  opts.context.route('**', routeHandler).catch(() => {});
  opts.context.on('response', responseHandler);

  // Abort handler
  opts.abortSignal.addEventListener('abort', cleanup, { once: true });

  return cleanup;
}
