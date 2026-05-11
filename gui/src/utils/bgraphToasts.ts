// ---------------------------------------------------------------------------
// Shared toast wording constants for bgraph import/export.
//
// Tests assert that emitted toasts CONTAIN these substrings (not exact-match).
// Code uses the same constants. Wording can evolve in one place; tests still
// catch regressions like a toast being silently swallowed or routed wrong.
//
// Pattern: each constant is the "stable" part of the message. Variable parts
// (filename, label, count) are appended at the call site.
// ---------------------------------------------------------------------------

export const BGRAPH_PARSE_ERROR_PREFIX = "Couldn't parse bgraph:";
export const BGRAPH_EMPTY_IMPORT_MSG = "Bgraph contains no cubes; import rejected";
export const BGRAPH_EMPTY_EXPORT_MSG = "Scene is empty; nothing to export";
export const BGRAPH_DUP_LABEL_PREFIX = "Duplicate port label";
export const BGRAPH_MISSING_LABEL_PREFIX = "Port at";
export const BGRAPH_TOO_LARGE_PREFIX = "Bgraph too large";
export const BGRAPH_PASTE_OVER_CAP_MSG = "Pasted text exceeds 5 MB cap";
export const BGRAPH_UNSUPPORTED_EXT_PREFIX = "Unsupported file";
export const BGRAPH_CONCURRENT_DROP_MSG = "Already loading; this drop was ignored";
export const BGRAPH_LOADING_PREFIX = "Loading";
export const BGRAPH_LOADED_PREFIX = "Loaded";
export const BGRAPH_EXPORT_PORT_LOSS_NOTE =
  "Note: external TQEC tools using from_json drop port cubes; piper-draw round-trip preserves them.";
export const BGRAPH_NORMALIZED_PREFIX = "Normalized";
export const BGRAPH_GALLERY_FETCH_FAILED_PREFIX = "Couldn't load example";
