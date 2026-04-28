import type { BrowserContext, Page, Route } from 'patchright';

// Injected into the page's JS context to intercept XHR/Fetch and extract media URLs
// embedded in JSON API responses (e.g. {"file":"https://cdn.../movie.m3u8?token=..."}).
// Calls window.__lensReportMedia(url) which is exposed via page.exposeFunction before goto.
export const WATCHER_SCRIPT = `
(function () {
  if (window.__lensWatcherInjected) return;
  window.__lensWatcherInjected = true;

  var VIDEO_KEYS = ['file','video_url','video','source','src','stream_url','media_url','url','hls','m3u8','link'];
  var MEDIA_PATTERN = /https?:\\/\\/[^\\s"',\\]\\[<>]+\\.(?:m3u8|mp4)(?:[?&#][^\\s"',\\]\\[<>]*)?/gi;

  function report(url) {
    if (typeof window.__lensReportMedia === 'function') {
      try { window.__lensReportMedia(url); } catch(e) {}
    }
  }

  function scanText(text) {
    if (!text || text.length > 300000) return;
    var matches = text.match(MEDIA_PATTERN) || [];
    for (var i = 0; i < matches.length; i++) {
      report(matches[i].replace(/[;)"'\`]+$/, ''));
    }
    try {
      var data = JSON.parse(text);
      scanObj(data, 0);
    } catch(e) {}
  }

  function scanObj(obj, depth) {
    if (depth > 10 || !obj || typeof obj !== 'object') return;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var val = obj[k];
      if (VIDEO_KEYS.indexOf(k) !== -1 && typeof val === 'string' && /\\.(?:m3u8|mp4)(\\?|$)/i.test(val)) {
        report(val);
      } else if (typeof val === 'object') {
        scanObj(val, depth + 1);
      }
    }
  }

  function shouldScan(ct) {
    return ct && (ct.indexOf('json') !== -1 || ct.indexOf('text/plain') !== -1 || ct.indexOf('mpegurl') !== -1);
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, url) {
    this._lensUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() {
      try {
        var ct = this.getResponseHeader('content-type') || '';
        if (shouldScan(ct)) scanText(this.responseText);
      } catch(e) {}
    });
    return origSend.apply(this, arguments);
  };

  var origFetch = window.fetch;
  window.fetch = function() {
    var args = arguments;
    return origFetch.apply(this, args).then(function(resp) {
      try {
        var ct = resp.headers.get('content-type') || '';
        if (shouldScan(ct)) {
          resp.clone().text().then(scanText).catch(function(){});
        }
      } catch(e) {}
      return resp;
    });
  };
})();
`;

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
  async function responseHandler(response: { url(): string; headers(): Record<string, string>; frame(): { url(): string } | null | undefined; request(): { url(): string; redirectedFrom(): { url(): string; redirectedFrom(): unknown } | null } }) {
    const url = response.url();
    const contentType = response.headers()['content-type'] ?? '';

    if (isAdUrl(url)) return;
    if (!isMediaUrl(url, contentType)) return;

    // Walk the redirect chain to recover the original pre-redirect URL.
    // Some proxy Workers embed auth in URL params (?headers=...) then redirect to a
    // cleaner URL — using the original URL preserves that auth in the KV payload so
    // pipe can replay segment requests with the right credentials.
    let candidateUrl = url;
    try {
      let req = response.request();
      while (req.redirectedFrom()) {
        req = req.redirectedFrom() as typeof req;
      }
      if (req.url() !== url) candidateUrl = req.url();
    } catch {
      // ignore — redirectedFrom may not be available on all response types
    }

    const reqHeaders = requestHeadersByUrl.get(candidateUrl) ?? requestHeadersByUrl.get(url) ?? {};
    const mediaType = classifyMedia(candidateUrl, contentType);

    let frameUrl: string | null = null;
    try {
      frameUrl = response.frame()?.url() ?? null;
    } catch {
      // cross-origin frame may throw
    }

    opts.onCandidate({
      url: candidateUrl,
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

