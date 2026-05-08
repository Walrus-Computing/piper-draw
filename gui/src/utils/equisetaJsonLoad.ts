/**
 * Loading helpers for `EquisetaJsonPanel`. Owns:
 *
 *   - parsing JSON text → validated `FtqcGraph` Result;
 *   - fetching bundled example fixtures from `gui/public/equiseta-examples/`;
 *   - fetching the manifest of bundled examples;
 *   - extracting + validating a single dropped file from a `DragEvent`.
 *
 * Callers (the panel + the toolbar dropdown) consume these primitives and
 * own the React state machine + concurrent-load token themselves.
 */

import { parseFtqcGraph, type FtqcGraph } from "./equisetaJsonSchema";

/** Hard cap on accepted file sizes. Equiseta JSON is verbose (≈600 bytes/node);
 * 5 MB ≈ 8000 nodes which is plausible for real test cases. */
export const MAX_BYTES = 5 * 1024 * 1024;

export const FIXTURES_PATH_SEGMENT = "equiseta-examples";

// -----------------------------------------------------------------------
// parseEquisetaText
// -----------------------------------------------------------------------

export type ParseTextResult =
  | { ok: true; value: FtqcGraph }
  | { ok: false; reason: "invalid-json"; message: string }
  | { ok: false; reason: "schema-mismatch"; path: string; expected: string; got: string };

/** Parse JSON text and validate the FTQCGraph schema in one step. */
export function parseEquisetaText(text: string): ParseTextResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      reason: "invalid-json",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const r = parseFtqcGraph(parsed);
  if (r.ok) return { ok: true, value: r.value };
  return { ok: false, reason: "schema-mismatch", path: r.path, expected: r.expected, got: r.got };
}

// -----------------------------------------------------------------------
// URL construction (BASE_URL-aware)
// -----------------------------------------------------------------------

/**
 * Build the URL for a bundled example fixture. `base` defaults to the Vite
 * `BASE_URL` (root in dev; configurable for non-root deploys). Exported with
 * a `base` parameter so tests can verify non-root behaviour without stubbing
 * the build-time env constant.
 */
export function buildExampleUrl(filename: string, base: string = import.meta.env.BASE_URL): string {
  // BASE_URL always ends with `/` (Vite contract).
  return `${base}${FIXTURES_PATH_SEGMENT}/${filename}`;
}

export function buildManifestUrl(base: string = import.meta.env.BASE_URL): string {
  return `${base}${FIXTURES_PATH_SEGMENT}/manifest.json`;
}

// -----------------------------------------------------------------------
// fetchEquisetaExample / fetchEquisetaManifest
// -----------------------------------------------------------------------

export type FetchResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

/** Fetch a fixture by filename. Returns Result; never throws. */
export async function fetchEquisetaExample(
  filename: string,
  base: string = import.meta.env.BASE_URL,
): Promise<FetchResult> {
  const url = buildExampleUrl(filename, base);
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, message: `HTTP ${resp.status}` };
    const text = await resp.text();
    return { ok: true, text };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export interface ManifestEntry {
  filename: string;
  name: string;
  description: string;
}

export type FetchManifestResult =
  | { ok: true; examples: ManifestEntry[] }
  | { ok: false; message: string };

export async function fetchEquisetaManifest(
  base: string = import.meta.env.BASE_URL,
): Promise<FetchManifestResult> {
  const url = buildManifestUrl(base);
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, message: `HTTP ${resp.status}` };
    const json = await resp.json();
    if (!isManifestShape(json)) {
      return { ok: false, message: "manifest.json shape unexpected" };
    }
    return { ok: true, examples: json.examples };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function isManifestShape(value: unknown): value is { examples: ManifestEntry[] } {
  if (value === null || typeof value !== "object") return false;
  const v = value as { examples?: unknown };
  if (!Array.isArray(v.examples)) return false;
  return v.examples.every(
    (e) =>
      e !== null &&
      typeof e === "object" &&
      typeof (e as ManifestEntry).filename === "string" &&
      typeof (e as ManifestEntry).name === "string" &&
      typeof (e as ManifestEntry).description === "string",
  );
}

// -----------------------------------------------------------------------
// Drag-and-drop file extraction
// -----------------------------------------------------------------------

export type GetDroppedFileResult =
  | { ok: true; text: string; filename: string }
  | { ok: false; reason: "no-file" }
  | { ok: false; reason: "wrong-ext"; ext: string }
  | { ok: false; reason: "oversized"; size: number; maxBytes: number }
  | { ok: false; reason: "read-error"; message: string };

/**
 * Extract the first file from a DragEvent's dataTransfer, validate
 * extension + size, and return its text. Multi-file drops take only
 * `files[0]`; the rest are silently dropped. Always resolves; never throws.
 */
export async function getDroppedJsonText(
  e: { dataTransfer: { files: FileList | File[] } | null },
  maxBytes: number = MAX_BYTES,
): Promise<GetDroppedFileResult> {
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return { ok: false, reason: "no-file" };
  const file: File = files instanceof FileList ? files[0] : files[0];
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (ext !== "json") return { ok: false, reason: "wrong-ext", ext };
  if (file.size > maxBytes) return { ok: false, reason: "oversized", size: file.size, maxBytes };
  try {
    const text = await file.text();
    return { ok: true, text, filename: file.name };
  } catch (err) {
    return {
      ok: false,
      reason: "read-error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
