/** VOD manifest, > 180s total duration, has audio track, no encryption */
export const VOD_LONG = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio.m3u8"
#EXTINF:10.0,
segment001.ts
#EXTINF:10.0,
segment002.ts
#EXTINF:10.0,
segment003.ts
#EXTINF:10.0,
segment004.ts
#EXTINF:10.0,
segment005.ts
#EXTINF:10.0,
segment006.ts
#EXTINF:10.0,
segment007.ts
#EXTINF:10.0,
segment008.ts
#EXTINF:10.0,
segment009.ts
#EXTINF:10.0,
segment010.ts
#EXTINF:10.0,
segment011.ts
#EXTINF:10.0,
segment012.ts
#EXTINF:10.0,
segment013.ts
#EXTINF:10.0,
segment014.ts
#EXTINF:10.0,
segment015.ts
#EXTINF:10.0,
segment016.ts
#EXTINF:10.0,
segment017.ts
#EXTINF:10.0,
segment018.ts
#EXTINF:10.0,
segment019.ts
#EXT-X-ENDLIST`;

/** Short VOD manifest, < 90s, no audio, no encryption */
export const VOD_SHORT = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:10.0,
seg1.ts
#EXTINF:10.0,
seg2.ts
#EXTINF:10.0,
seg3.ts
#EXTINF:10.0,
seg4.ts
#EXTINF:10.0,
seg5.ts
#EXT-X-ENDLIST`;

/** Live manifest with EXT-X-PLAYLIST-TYPE:EVENT (Tier 1 definitive) */
export const LIVE_EVENT = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:EVENT
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:6.0,
live100.ts
#EXTINF:6.0,
live101.ts
#EXTINF:6.0,
live102.ts`;

/** Ambiguous manifest — no EXT-X-PLAYLIST-TYPE, no EXT-X-ENDLIST (Tier 2 candidate) */
export const LIVE_AMBIGUOUS = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:500
#EXTINF:6.0,
chunk500.ts
#EXTINF:6.0,
chunk501.ts
#EXTINF:6.0,
chunk502.ts`;

/** Encrypted manifest with EXT-X-KEY AES-128 */
export const ENCRYPTED = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/key1"
#EXTINF:10.0,
enc001.ts
#EXTINF:10.0,
enc002.ts
#EXTINF:10.0,
enc003.ts
#EXT-X-ENDLIST`;

/** VOD manifest with EXT-X-ENDLIST that appeared during re-fetch (was still-writing) */
export const VOD_DELAYED_ENDLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
seg1.ts
#EXTINF:10.0,
seg2.ts
#EXTINF:10.0,
seg3.ts
#EXT-X-ENDLIST`;

/** Medium-length VOD (between 90s and 180s) — neutral duration score */
export const VOD_MEDIUM = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:10.0,
s1.ts
#EXTINF:10.0,
s2.ts
#EXTINF:10.0,
s3.ts
#EXTINF:10.0,
s4.ts
#EXTINF:10.0,
s5.ts
#EXTINF:10.0,
s6.ts
#EXTINF:10.0,
s7.ts
#EXTINF:10.0,
s8.ts
#EXTINF:10.0,
s9.ts
#EXTINF:10.0,
s10.ts
#EXTINF:10.0,
s11.ts
#EXTINF:10.0,
s12.ts
#EXT-X-ENDLIST`;
