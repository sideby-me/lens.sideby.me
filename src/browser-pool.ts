import { chromium } from 'patchright';
import type { Browser } from 'patchright';
import { logInfo, logWarn, logError } from './telemetry/logs.js';

let browser: Browser | null = null;
let respawnPromise: Promise<Browser> | null = null;
let isShuttingDown = false;
let respawnCount = 0;
const MAX_RESPAWN_ATTEMPTS = 3;

function attachDisconnectedListener(b: Browser): void {
  b.on('disconnected', () => {
    if (isShuttingDown) return;
    handleCrash();
  });
}

function handleCrash(): void {
  respawnCount++;
  logWarn('Browser crashed', { domain: 'capture', event: 'browser_crashed', attempt: respawnCount });

  if (respawnCount > MAX_RESPAWN_ATTEMPTS) {
    logError('Browser respawn limit reached', { domain: 'capture', event: 'browser_respawn_limit_reached', attempts: respawnCount });
    process.exit(1);
  }

  respawnPromise = chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--use-gl=angle',
      '--use-angle=gl',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  respawnPromise
    .then((newBrowser) => {
      browser = newBrowser;
      respawnPromise = null;
      attachDisconnectedListener(newBrowser);
      respawnCount = 0;
      logInfo('Browser respawned', { domain: 'capture', event: 'browser_respawn_complete' });
    })
    .catch((err: Error) => {
      logError('Browser respawn failed', { domain: 'capture', event: 'browser_respawn_failed', error: err.message });
      process.exit(1);
    });
}

export async function initBrowserPool(): Promise<void> {
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--use-gl=angle',
      '--use-angle=gl',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  attachDisconnectedListener(browser);
  respawnCount = 0;
  logInfo('Browser pool initialized', { domain: 'capture', event: 'browser_pool_init' });
}

export async function getBrowser(): Promise<Browser> {
  if (isShuttingDown) {
    throw new Error('Browser pool is shutting down');
  }
  if (respawnPromise) {
    return respawnPromise;
  }
  if (browser === null) {
    throw new Error('Browser pool not initialized — call initBrowserPool() first');
  }
  return browser;
}

export async function shutdownBrowserPool(): Promise<void> {
  isShuttingDown = true;
  logInfo('Shutting down browser pool', { domain: 'capture', event: 'browser_pool_shutdown' });
  await browser?.close().catch(() => {});
  browser = null;
}
