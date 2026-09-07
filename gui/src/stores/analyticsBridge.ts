import { useBlockStore } from "./blockStore";
import { TUTORIAL_STORAGE_KEY, useTutorialStore } from "./tutorialStore";
import { track } from "../utils/analytics";

/**
 * Store-driven analytics events. Lives in `stores/` (not `utils/`) because it
 * subscribes to Zustand stores; keeping the subscriptions here means the hot
 * files (`blockStore`, panels) need zero analytics call sites.
 *
 * Events:
 * - `first-edit` — first undo-history entry of the page load (the activation
 *   signal: the visitor actually edited a scene, by any means).
 * - `zx-panel-opened` / `flows-panel-opened` — each closed→open transition.
 * - `tutorial-started` / `tutorial-completed` / `tutorial-dismissed` — the
 *   completed-vs-dismissed split reads the value `tutorialStore` persists to
 *   localStorage right before it deactivates, which is the authoritative
 *   record of how the tutorial ended.
 */
export function initAnalyticsBridge(): void {
  let firstEditSent = useBlockStore.getState().history.length > 0;
  let prevZxOpen = useBlockStore.getState().zxPanelOpen;
  let prevFlowsOpen = useBlockStore.getState().flowsPanelOpen;
  useBlockStore.subscribe((s) => {
    if (!firstEditSent && s.history.length > 0) {
      firstEditSent = true;
      track("first-edit");
    }
    if (s.zxPanelOpen && !prevZxOpen) track("zx-panel-opened");
    if (s.flowsPanelOpen && !prevFlowsOpen) track("flows-panel-opened");
    prevZxOpen = s.zxPanelOpen;
    prevFlowsOpen = s.flowsPanelOpen;
  });

  let prevTutorialActive = useTutorialStore.getState().active;
  useTutorialStore.subscribe((s) => {
    if (s.active && !prevTutorialActive) track("tutorial-started");
    if (!s.active && prevTutorialActive) {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(TUTORIAL_STORAGE_KEY);
      } catch {
        // No browser storage → can't distinguish; report as dismissed.
      }
      track(stored === "completed" ? "tutorial-completed" : "tutorial-dismissed");
    }
    prevTutorialActive = s.active;
  });
}
