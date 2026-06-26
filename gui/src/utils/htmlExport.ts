// ---------------------------------------------------------------------------
// htmlExport — produce a single self-contained .html file that renders the
// current view as an interactive, orbit-able 3D object (no editor, no server).
//
// The deployed app ships a prebuilt, fully-inlined `viewer.html` (see
// vite.viewer.config.ts + src/viewer/). We fetch it, splice the frozen-view
// blob in as a classic <script> in <head> (runs before the deferred module
// bundle reads window.__PIPER_VIEW__), and download the result.
// ---------------------------------------------------------------------------

import type { ViewSnapshotV1 } from "./viewSnapshot";

const DEFAULT_FILENAME = "pipe-diagram.html";

/** Escape a string for safe interpolation into a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Ready-to-paste embed snippet for a webpage (e.g. tqec's docs gallery).
 * The filename comes from the user's Save dialog, so it is HTML-escaped to
 * avoid attribute-injection / malformed markup when it contains quotes.
 * 600×400 is a sensible starting size — adjust width/height for your layout.
 */
export function iframeSnippet(filename = DEFAULT_FILENAME): string {
  return `<iframe src="${escapeAttr(filename)}" width="600" height="400" style="border:none"></iframe>`;
}

/** URL of the prebuilt inlined viewer shell, relative to the app's base. */
function viewerHtmlUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}viewer.html`;
}

/**
 * Escape a JSON string so it is safe to embed inside a <script> element:
 * `</script>` and `<!--`/`-->` sequences must not terminate or comment the block.
 * Exported for tests.
 */
export function jsonForScript(json: string): string {
  return json.replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e");
}

/** Splice the frozen-view blob into the viewer shell. Exported for tests. */
export function injectBlob(html: string, view: ViewSnapshotV1): string {
  const json = jsonForScript(JSON.stringify(view));
  const tag = `<script>window.__PIPER_VIEW__=${json};</script>`;
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return html.slice(0, headClose) + tag + "\n" + html.slice(headClose);
  }
  // No <head> (unexpected) — prepend so the classic script still runs first.
  return tag + "\n" + html;
}

/**
 * True if the fetched shell is a non-inlined dev shell (references /@vite/client
 * or external /src/ module scripts) — such a file can't load offline. Exported
 * for tests.
 */
export function isDevShell(html: string): boolean {
  return html.includes("/@vite/client") || /<script[^>]*\bsrc="\/src\//.test(html);
}

/** Returns the filename actually written, or null if the user cancelled. */
async function downloadHtml(html: string, filename: string): Promise<string | null> {
  const blob = new Blob([html], { type: "text/html" });

  const w = window as Window & {
    showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  };
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "HTML file", accept: { "text/html": [".html"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return handle.name;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      throw err;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}

/**
 * Fetch the inlined viewer shell, splice in the frozen view, and prompt the
 * user to save it. Returns the saved filename (for building the embed snippet),
 * or null if cancelled. Throws if the viewer shell can't be fetched (e.g.
 * running against a dev server that hasn't produced a built viewer.html).
 */
export async function exportStandaloneHtml(
  view: ViewSnapshotV1,
  filename = DEFAULT_FILENAME,
): Promise<string | null> {
  const res = await fetch(viewerHtmlUrl());
  if (!res.ok) {
    throw new Error(`Could not load the embed viewer (${res.status}). Build the app first.`);
  }
  const shell = await res.text();
  // Guard: a non-inlined shell (dev markers / external module refs) would save
  // to a file that can't load offline. Refuse rather than emit a broken file.
  if (shell.includes("/@vite/client") || /<script[^>]*\bsrc="\/src\//.test(shell)) {
    throw new Error(
      "The embed viewer isn't bundled for offline use. Run a production build " +
        "(npm run build) — the standalone export needs the inlined viewer.html.",
    );
  }
  return downloadHtml(injectBlob(shell, view), filename);
}
