import type { SceneSnapshotV1 } from "./sceneSnapshot";
import { isSceneSnapshotV1 } from "./sceneSnapshot";

export const SCENE_HASH_KEY = "scene";

const COMPRESSION_FORMAT = "deflate-raw" as const;

// Hard caps applied to decoder inputs. The encoder is uncapped because we only
// compress data we trust (captureSnapshot from our own store).
//
// MAX_HASH_PARAM_LEN: ceiling on the base64url payload after `#scene=`. Comfortably
// above the encoder's 6 KiB URL cap (Toolbar.SHARE_URL_MAX_LEN) and well below
// browser hash limits, so a hostile URL can't force us to even start decoding a
// huge blob. ~8 KiB also bounds the worst-case work in base64UrlToBytes/atob.
//
// MAX_DECOMPRESSED_LEN: cap on the decompressed output. deflate routinely hits
// >1000:1 on repetitive payloads, so without a streaming guard a small URL can
// expand to hundreds of MB. 2 MiB is roughly 50× the largest legitimate scene.
const MAX_HASH_PARAM_LEN = 8 * 1024;
const MAX_DECOMPRESSED_LEN = 2 * 1024 * 1024;

export function isCompressionStreamSupported(): boolean {
  return (
    typeof CompressionStream !== "undefined" &&
    typeof DecompressionStream !== "undefined"
  );
}

async function compress(input: Uint8Array): Promise<Uint8Array> {
  // Typed as GenericTransformStream so writer.write accepts our untyped
  // BufferSource without a TS5 narrowing fight on Uint8Array<ArrayBufferLike>.
  const transform: GenericTransformStream = new CompressionStream(COMPRESSION_FORMAT);
  const writer = transform.writable.getWriter();
  // Swallow writer-side rejections so they don't become unhandled. The
  // canonical error surface is the readable side, which the caller awaits.
  writer.write(input).catch(() => {});
  writer.close().catch(() => {});
  const buf = await new Response(transform.readable).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Decompresses `input` via DecompressionStream, aborting and returning null if
 * the cumulative output exceeds `maxBytes`. Streamed reads keep memory bounded
 * even when the source is a deflate bomb.
 */
async function decompressWithCap(
  input: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const transform: GenericTransformStream = new DecompressionStream(COMPRESSION_FORMAT);
  const writer = transform.writable.getWriter();
  writer.write(input).catch(() => {});
  writer.close().catch(() => {});

  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  // Chunk to keep apply() argument count safe across engines.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeSnapshotToHashParam(
  snapshot: SceneSnapshotV1,
): Promise<string> {
  const json = JSON.stringify(snapshot);
  const compressed = await compress(new TextEncoder().encode(json));
  return bytesToBase64Url(compressed);
}

/**
 * Accepts any of: "#scene=xyz", "scene=xyz", "?scene=xyz", "&scene=xyz",
 * or a full URL containing "scene=xyz". Returns the value, or null if
 * no `scene` parameter is present.
 */
export function parseSceneHashParam(hashOrUrl: string): string | null {
  const re = /(?:^|[#?&])scene=([^&]*)/;
  const match = re.exec(hashOrUrl);
  if (!match || !match[1]) return null;
  return match[1];
}

export async function decodeSnapshotFromHash(
  hashOrUrl: string,
): Promise<SceneSnapshotV1 | null> {
  const param = parseSceneHashParam(hashOrUrl);
  if (!param) return null;
  if (param.length > MAX_HASH_PARAM_LEN) return null;
  try {
    const bytes = base64UrlToBytes(param);
    const decompressed = await decompressWithCap(bytes, MAX_DECOMPRESSED_LEN);
    if (!decompressed) return null;
    const json = new TextDecoder().decode(decompressed);
    const parsed: unknown = JSON.parse(json);
    if (!isSceneSnapshotV1(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildShareUrl(hashParam: string, base?: string): string {
  const b =
    base ??
    (typeof window !== "undefined"
      ? window.location.origin + window.location.pathname + window.location.search
      : "");
  return `${b}#${SCENE_HASH_KEY}=${hashParam}`;
}
