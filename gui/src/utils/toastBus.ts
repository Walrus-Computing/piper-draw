// ---------------------------------------------------------------------------
// Shared toast bus (error + info channels)
//
//   ┌─────────── producers ───────────┐         ┌──── consumers ──────┐
//   │ blockStore.groupToggle          │         │ validationStore     │
//   │ blockStore.applyAutoDissolve    │ error → │   .reportEphemeralError
//   │ App.tsx rotation aborted        │         │  (clears errors,    │
//   │                                 │         │   sets "aborted")   │
//   │ blockStore group/dissolve toasts│         ├─────────────────────┤
//   │ App.tsx migration toast         │  info → │ ValidationToast.tsx │
//   │                                 │         │  (overlay only —    │
//   │                                 │         │   leaves invalidKeys│
//   │                                 │         │   intact)           │
//   └─────────────────────────────────┘         └─────────────────────┘
//
// Architectural invariants:
//   • Plain event-emitter (no React, no Zustand). Subscribers run synchronously
//     during emit() — replaces the old `void import("./validationStore")`
//     dynamic-import workaround that fired toasts a microtask later.
//   • The `info` channel does NOT touch validationStore state — this is the
//     R7 fix: dissolve / "Select 2+" / "mixed selection" toasts no longer
//     clobber `status: "invalid"` highlights from a prior verify.
//   • Error-channel emissions remain destructive (status → "aborted") for
//     genuine action aborts (rotation, flip).
// ---------------------------------------------------------------------------

type ToastListener = (message: string) => void;

class ToastChannel {
  private listeners = new Set<ToastListener>();

  subscribe(fn: ToastListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(message: string): void {
    for (const fn of this.listeners) fn(message);
  }
}

export const toastBus = {
  error: new ToastChannel(),
  info: new ToastChannel(),
};
