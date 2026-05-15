import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLaunch, mockClose, mockOn } = vi.hoisted(() => ({
  mockLaunch: vi.fn(),
  mockClose: vi.fn(),
  mockOn: vi.fn(),
}));

vi.mock('patchright', () => ({
  chromium: { launch: mockLaunch },
}));

vi.mock('../telemetry/logs.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockClose.mockResolvedValue(undefined);
  mockOn.mockImplementation(() => {});
  mockLaunch.mockResolvedValue({ on: mockOn, close: mockClose });
});

describe('browser-pool', () => {
  it('getBrowser() awaits respawnPromise during crash recovery', async () => {
    const { initBrowserPool, getBrowser } = await import('../browser-pool.js');

    // Capture the 'disconnected' callback registered during initBrowserPool
    let disconnectedCallback: (() => void) | undefined;
    mockOn.mockImplementation((event: string, cb: () => void) => {
      if (event === 'disconnected') disconnectedCallback = cb;
    });

    await initBrowserPool();

    expect(disconnectedCallback).toBeDefined();

    // Set up deferred promise for the respawn browser
    let resolveRespawn!: (b: unknown) => void;
    const respawnBrowser = { on: mockOn, close: mockClose };
    const deferredRespawn = new Promise((resolve) => {
      resolveRespawn = resolve as (b: unknown) => void;
    });
    // Second launch call returns the deferred promise
    mockLaunch.mockReturnValueOnce(deferredRespawn);

    // Trigger crash — handleCrash sets respawnPromise
    disconnectedCallback!();

    // getBrowser() should return the pending respawnPromise
    const browserPromise = getBrowser();

    // Resolve the respawn
    resolveRespawn(respawnBrowser);

    expect(await browserPromise).toBe(respawnBrowser);
    expect(mockLaunch).toHaveBeenCalledTimes(2);
  });

  it('crash detection triggers respawn and logs browser_crashed', async () => {
    const { initBrowserPool } = await import('../browser-pool.js');

    // Capture the 'disconnected' callback
    let disconnectedCallback: (() => void) | undefined;
    mockOn.mockImplementation((event: string, cb: () => void) => {
      if (event === 'disconnected') disconnectedCallback = cb;
    });

    await initBrowserPool();

    expect(disconnectedCallback).toBeDefined();

    // Trigger crash
    disconnectedCallback!();

    // Allow the respawn promise chain to settle
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockLaunch).toHaveBeenCalledTimes(2);

    // Import the mocked logWarn to verify it was called correctly
    const { logWarn } = await import('../telemetry/logs.js');
    expect(logWarn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ domain: 'capture', event: 'browser_crashed' }),
    );
  });

  it('shutdownBrowserPool() resolves and disconnected does NOT trigger respawn', async () => {
    const { initBrowserPool, shutdownBrowserPool } = await import('../browser-pool.js');

    // Capture the 'disconnected' callback
    let disconnectedCallback: (() => void) | undefined;
    mockOn.mockImplementation((event: string, cb: () => void) => {
      if (event === 'disconnected') disconnectedCallback = cb;
    });

    await initBrowserPool();

    expect(disconnectedCallback).toBeDefined();

    await shutdownBrowserPool();

    // Trigger disconnected after shutdown — should NOT respawn
    disconnectedCallback!();

    // Allow any async microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Only the initial launch, no respawn
    expect(mockLaunch).toHaveBeenCalledTimes(1);
  });
});
