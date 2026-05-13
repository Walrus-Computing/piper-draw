/**
 * Imperative load helpers consumed by EquisetaJsonPanel and EquisetaMenu.
 * Lives in a separate module so the panel file can satisfy
 * `react-refresh/only-export-components`.
 *
 * Each helper:
 *   1. opens the panel (if relevant);
 *   2. begins a load on the store (which bumps the token);
 *   3. orchestrates fetch + parse;
 *   4. dispatches finishLoadOk / finishLoadErr — the store's own token check
 *      ensures stale results never overwrite fresh ones.
 */

import { useBlockStore } from "../stores/blockStore";
import { useEquisetaJsonStore } from "../stores/equisetaJsonStore";
import {
  parseEquisetaText,
  fetchEquisetaExample,
  MAX_BYTES,
} from "./equisetaJsonLoad";
import { pickFile } from "./filePicker";
import { runEquisetaImport } from "./equisetaImportController";

/** Load from arbitrary JSON text (drop, picker). */
export async function loadEquisetaText(text: string, sourceLabel: string): Promise<void> {
  const store = useEquisetaJsonStore.getState();
  const token = store.beginLoad(sourceLabel);
  const r = parseEquisetaText(text);
  if (r.ok) {
    store.finishLoadOk(token, r.value, sourceLabel);
    // Token re-check: finishLoadOk discards JSON-side state on a stale token, but
    // runEquisetaImport mutates blockStore separately. Without this check, a late
    // fetch could clobber a newer scene that already loaded.
    if (useEquisetaJsonStore.getState().loadToken === token) {
      runEquisetaImport(r.value, sourceLabel, "replace");
    }
  } else if (r.reason === "invalid-json") {
    store.finishLoadErr(token, `Invalid JSON: ${r.message}`);
  } else {
    store.finishLoadErr(
      token,
      `Schema mismatch at ${r.path}: expected ${r.expected}, got ${r.got}`,
    );
  }
}

// Defense-in-depth against a tampered manifest.json: only allow simple bare
// filenames matching the bundled-fixture pattern. Prevents `../`, absolute
// paths, encoded path separators, etc. from constructing arbitrary same-origin
// fetches even if the manifest is somehow corrupted.
const SAFE_FILENAME_RE = /^[a-z0-9_-]+\.json$/i;

/** Load a bundled fixture by filename. Opens the panel as a side effect. */
export async function loadEquisetaFixture(filename: string, displayName: string): Promise<void> {
  useBlockStore.getState().setEquisetaPanelOpen(true);
  const store = useEquisetaJsonStore.getState();
  const token = store.beginLoad(displayName);
  if (!SAFE_FILENAME_RE.test(filename)) {
    store.finishLoadErr(
      token,
      `Refusing to load fixture with unsafe filename: ${JSON.stringify(filename)}`,
    );
    return;
  }
  const r = await fetchEquisetaExample(filename);
  if (!r.ok) {
    store.finishLoadErr(token, `Fetch failed: ${r.message}`);
    return;
  }
  const p = parseEquisetaText(r.text);
  if (p.ok) {
    store.finishLoadOk(token, p.value, displayName);
    // Token re-check — see loadEquisetaText for rationale.
    if (useEquisetaJsonStore.getState().loadToken === token) {
      runEquisetaImport(p.value, displayName, "replace");
    }
  } else if (p.reason === "invalid-json") {
    store.finishLoadErr(token, `Invalid JSON in ${filename}: ${p.message}`);
  } else {
    store.finishLoadErr(
      token,
      `Schema mismatch at ${p.path}: expected ${p.expected}, got ${p.got}`,
    );
  }
}

/** Open the file picker and load the chosen JSON. Opens the panel only on
 * successful pick or pick error so cancel doesn't leave the panel visible
 * with an empty state. */
export async function loadEquisetaViaPicker(): Promise<void> {
  const r = await pickFile({ accept: ".json,application/json", maxBytes: MAX_BYTES });
  if (!r.ok) {
    if (r.reason === "cancelled") return;
    useBlockStore.getState().setEquisetaPanelOpen(true);
    const store = useEquisetaJsonStore.getState();
    const token = store.beginLoad("(file picker)");
    if (r.reason === "oversized") {
      store.finishLoadErr(token, `File too large (max ${MAX_BYTES} bytes)`);
    } else {
      store.finishLoadErr(token, `Read error: ${r.message ?? "unknown"}`);
    }
    return;
  }
  useBlockStore.getState().setEquisetaPanelOpen(true);
  await loadEquisetaText(r.text, "(picked file)");
}
