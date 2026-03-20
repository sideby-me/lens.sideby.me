import { Parser } from 'm3u8-parser';
import type { ManifestInfo } from './types.js';

const LIVE_RECHECK_MS = Number(process.env.LIVE_RECHECK_MS ?? 2000);

type ParsedManifest = InstanceType<typeof Parser>['manifest'];

export async function fetchAndParseManifest(
  url: string,
  headers: Record<string, string>,
): Promise<ManifestInfo | null> {
  try {
    const manifest = await doFetch(url, headers);
    if (!manifest) return null;

    const isLive = await detectLive(url, headers, manifest);
    const duration = computeDuration(manifest);
    const hasAudioTrack = checkAudio(manifest);
    const encrypted = checkEncrypted(manifest);

    return { isLive, duration, hasAudioTrack, encrypted };
  } catch {
    return null;
  }
}

async function doFetch(
  url: string,
  headers: Record<string, string>,
): Promise<ParsedManifest | null> {
  let body: string;
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return null;
    body = await response.text();
  } catch {
    return null;
  }

  if (!body || !body.trim().startsWith('#EXTM3U')) return null;

  const parser = new Parser();
  parser.push(body);
  parser.end();
  return parser.manifest;
}

async function detectLive(
  url: string,
  headers: Record<string, string>,
  manifest: ParsedManifest,
): Promise<boolean> {
  // Tier 1 — definitive: playlistType present
  const playlistType = manifest.playlistType?.toUpperCase();
  if (playlistType === 'EVENT' || playlistType === 'LIVE') return true;
  if (playlistType === 'VOD') return false;

  // If endList is present with no playlistType, it's a complete VOD
  if (manifest.endList === true) return false;

  // Tier 2 — ambiguous: no playlistType, no endList; re-fetch after delay
  await new Promise<void>((resolve) => setTimeout(resolve, LIVE_RECHECK_MS));

  try {
    const reManifest = await doFetch(url, headers);
    if (!reManifest) return true; // fetch failed, assume live
    return reManifest.endList !== true;
  } catch {
    return true; // re-fetch error, assume live
  }
}

function computeDuration(manifest: ParsedManifest): number {
  return (
    manifest.segments?.reduce((sum: number, s: { duration?: number }) => sum + (s.duration ?? 0), 0) ?? 0
  );
}

function checkAudio(manifest: ParsedManifest): boolean {
  return Object.keys(manifest.mediaGroups?.AUDIO ?? {}).length > 0;
}

function checkEncrypted(manifest: ParsedManifest): boolean {
  return (
    manifest.segments?.some(
      (s: { key?: { method: string } }) => s.key && s.key.method !== 'NONE',
    ) ?? false
  );
}
