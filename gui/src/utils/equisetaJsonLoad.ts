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

export interface ManifestGroup {
  label: string;
  examples: ManifestEntry[];
}

export type FetchManifestResult =
  | { ok: true; groups: ManifestGroup[]; examples: ManifestEntry[] }
  | { ok: false; message: string };

export async function fetchEquisetaManifest(
  base: string = import.meta.env.BASE_URL,
): Promise<FetchManifestResult> {
  const url = buildManifestUrl(base);
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, message: `HTTP ${resp.status}` };
    const json = await resp.json();
    const parsed = parseManifestShape(json);
    if (parsed === null) {
      return { ok: false, message: "manifest.json shape unexpected" };
    }
    return { ok: true, groups: parsed.groups, examples: parsed.examples };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (value === null || typeof value !== "object") return false;
  const e = value as ManifestEntry;
  return (
    typeof e.filename === "string" &&
    typeof e.name === "string" &&
    typeof e.description === "string"
  );
}

/**
 * Parse either the new grouped manifest shape (`groups: [{label, examples}]`)
 * or the legacy flat shape (`examples: [...]`). Always returns both `groups`
 * and a flat `examples` projection — flat consumers (fallback list, search)
 * stay simple, structured consumers (the dropdown) get the labels.
 */
function parseManifestShape(
  value: unknown,
): { groups: ManifestGroup[]; examples: ManifestEntry[] } | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as { examples?: unknown; groups?: unknown };

  if (Array.isArray(v.groups)) {
    const groups: ManifestGroup[] = [];
    const flat: ManifestEntry[] = [];
    for (const g of v.groups) {
      if (g === null || typeof g !== "object") return null;
      const gObj = g as { label?: unknown; examples?: unknown };
      if (typeof gObj.label !== "string" || !Array.isArray(gObj.examples)) return null;
      const items: ManifestEntry[] = [];
      for (const e of gObj.examples) {
        if (!isManifestEntry(e)) return null;
        items.push(e);
        flat.push(e);
      }
      groups.push({ label: gObj.label, examples: items });
    }
    return { groups, examples: flat };
  }

  if (Array.isArray(v.examples)) {
    const flat: ManifestEntry[] = [];
    for (const e of v.examples) {
      if (!isManifestEntry(e)) return null;
      flat.push(e);
    }
    // Legacy single-group: render unlabeled by collapsing to one group.
    return { groups: [{ label: "", examples: flat }], examples: flat };
  }

  return null;
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
