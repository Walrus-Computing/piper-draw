import type { SceneSnapshotV1 } from "./sceneSnapshot";
import { isSceneSnapshotV1 } from "./sceneSnapshot";

export const SCENE_HASH_KEY = "scene";

const COMPRESSION_FORMAT = "deflate-raw" as const;

export function isCompressionStreamSupported(): boolean {
  return (
    typeof CompressionStream !== "undefined" &&
    typeof DecompressionStream !== "undefined"
  );
}

async function runStream(
  input: Uint8Array,
  transform: GenericTransformStream,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Swallow writer-side rejections so they don't become unhandled. The
  // canonical error surface is the readable side, which the caller awaits.
  writer.write(input).catch(() => {});
  writer.close().catch(() => {});
  const buf = await new Response(transform.readable).arrayBuffer();
  return new Uint8Array(buf);
}

async function compress(input: Uint8Array): Promise<Uint8Array> {
  return runStream(input, new CompressionStream(COMPRESSION_FORMAT));
}

async function decompress(input: Uint8Array): Promise<Uint8Array> {
  return runStream(input, new DecompressionStream(COMPRESSION_FORMAT));
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
  try {
    const bytes = base64UrlToBytes(param);
    const decompressed = await decompress(bytes);
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
