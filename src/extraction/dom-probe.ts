import type { Page, Frame } from 'patchright';

export interface VideoProbeResult {
  area: number | null;
  muted: boolean;
}

/**
 * Probe all frames for a <video> element whose currentSrc matches candidateUrl.
 * Returns area (width*height from boundingBox) and muted state.
 * Cross-origin frames that throw on evaluate() return null for area and false for muted.
 */
export async function probeVideoElement(page: Page, candidateUrl: string): Promise<VideoProbeResult> {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const result = await frame.evaluate((url: string) => {
        const videos = Array.from(document.querySelectorAll('video'));
        const match = videos.find(v => v.currentSrc === url || v.src === url);
        if (!match) return null;
        const rect = match.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          muted: match.muted,
        };
      }, candidateUrl);

      if (result) {
        return {
          area: result.width * result.height,
          muted: result.muted,
        };
      }
    } catch {
      // Cross-origin frame — cannot evaluate, continue to next frame
    }
  }

  // No matching video element found in any frame
  return { area: null, muted: false };
}

/**
 * Inject a hidden <video> element pointing to url and call load().
 * This forces a video-type network request (Accept: video/*) to the URL,
 * which is useful when the URL serves video bytes for video requests but
 * HTML for main-page navigation requests.
 */
export async function injectVideoElement(page: Page, url: string): Promise<void> {
  await page.evaluate((videoUrl: string) => {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.src = videoUrl;
    Object.assign(v.style, { position: 'fixed', opacity: '0', width: '1px', height: '1px', pointerEvents: 'none' });
    document.body?.appendChild(v);
    v.load();
  }, url).catch(() => {});
}

/**
 * Find the largest visible <video> or element with [data-video], [role="button"]
 * near a video across all accessible frames, and click it.
 * Returns true if a click was performed, false if no suitable element found.
 */
export async function clickLargestVideo(page: Page): Promise<boolean> {
  const frames = page.frames();
  let bestElement: { frame: Frame; selector: string; area: number } | null = null;

  for (const frame of frames) {
    try {
      const result = await frame.evaluate(() => {
        // Look for video elements and common play button patterns
        const candidates: { selector: string; area: number }[] = [];

        // Check video elements
        const videos = Array.from(document.querySelectorAll('video'));
        for (const v of videos) {
          const rect = v.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            candidates.push({
              selector: `video[src="${v.src}"]`,
              area: rect.width * rect.height,
            });
          }
        }

        // Check common play button containers
        const playButtons = Array.from(
          document.querySelectorAll(
            '[class*="play"], [aria-label*="play" i], [data-testid*="play"], button[class*="video"]'
          )
        );
        for (const btn of playButtons) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 20 && rect.height > 20) {
            candidates.push({
              // Use a unique selector path
              selector: `[aria-label="${(btn as HTMLElement).getAttribute('aria-label')}"]`,
              area: rect.width * rect.height,
            });
          }
        }

        if (candidates.length === 0) return null;
        // Return the largest element
        candidates.sort((a, b) => b.area - a.area);
        return candidates[0];
      });

      if (result && (!bestElement || result.area > bestElement.area)) {
        bestElement = { frame, selector: result.selector, area: result.area };
      }
    } catch {
      // Cross-origin frame — skip
    }
  }

  if (!bestElement) return false;

  try {
    // Click using Playwright's click which handles scrolling and visibility
    await bestElement.frame.click(bestElement.selector, { timeout: 3000 });
    return true;
  } catch {
    // If specific selector fails, try clicking the center of the largest video
    try {
      const frames2 = page.frames();
      for (const frame of frames2) {
        try {
          const videoInfo = await frame.evaluate(() => {
            const videos = Array.from(document.querySelectorAll('video'));
            if (videos.length === 0) return null;
            const sorted = videos.sort((a, b) => {
              const ra = a.getBoundingClientRect();
              const rb = b.getBoundingClientRect();
              return rb.width * rb.height - ra.width * ra.height;
            });
            const rect = sorted[0].getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          });
          if (videoInfo) {
            await page.mouse.click(videoInfo.x, videoInfo.y);
            return true;
          }
        } catch {
          continue;
        }
      }
    } catch {
      // complete failure
    }
    return false;
  }
}
