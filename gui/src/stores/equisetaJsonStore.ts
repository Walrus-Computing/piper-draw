/**
 * Lightweight Zustand store for the Equiseta JSON viewer.
 *
 * Keeps the `loaded` JSON, `loading` flag, `error` message, `viewMode`
 * toggle, and the `loadToken` for race-detection on concurrent loads. The
 * panel-open boolean lives in `blockStore` (`equisetaPanelOpen`) to mirror
 * `flowsPanelOpen`; data state lives here so it doesn't grow blockStore.
 *
 * Loaded JSON is preserved across failed reloads — if a fetch errors, the
 * previously-loaded content stays on screen and an inline error is shown
 * alongside it. Reset only happens explicitly via `reset()`.
 */

import { create } from "zustand";
import type { FtqcGraph } from "../utils/equisetaJsonSchema";

export type ViewMode = "json" | "grid";

export interface LoadedEquiseta {
  graph: FtqcGraph;
  sourceLabel: string;
}

interface EquisetaJsonState {
  loaded: LoadedEquiseta | null;
  loading: boolean;
  /** Source label currently being loaded, for the spinner caption. */
  loadingLabel: string | null;
  error: string | null;
  viewMode: ViewMode;
  /** Monotonic token bumped on every load entry. Late-arriving fetches whose
   * token doesn't match are silently dropped to avoid "older file wins" races. */
  loadToken: number;

  beginLoad: (sourceLabel: string) => number;
  finishLoadOk: (token: number, graph: FtqcGraph, sourceLabel: string) => void;
  finishLoadErr: (token: number, message: string) => void;
  clearError: () => void;
  setViewMode: (mode: ViewMode) => void;
  reset: () => void;
}

export const useEquisetaJsonStore = create<EquisetaJsonState>((set, get) => ({
  loaded: null,
  loading: false,
  loadingLabel: null,
  error: null,
  viewMode: "json",
  loadToken: 0,

  beginLoad: (sourceLabel) => {
    const next = get().loadToken + 1;
    set({ loadToken: next, loading: true, loadingLabel: sourceLabel, error: null });
    return next;
  },

  finishLoadOk: (token, graph, sourceLabel) => {
    if (get().loadToken !== token) return;
    set({ loaded: { graph, sourceLabel }, loading: false, loadingLabel: null, error: null });
  },

  finishLoadErr: (token, message) => {
    if (get().loadToken !== token) return;
    set({ loading: false, loadingLabel: null, error: message });
  },

  clearError: () => set({ error: null }),

  setViewMode: (mode) => set({ viewMode: mode }),

  reset: () =>
    set({
      loaded: null,
      loading: false,
      loadingLabel: null,
      error: null,
      // viewMode persists across reset by design
    }),
}));
