import { create } from "zustand";
import { useBlockStore } from "./blockStore";
import { useValidationStore } from "./validationStore";
import {
  TUTORIAL_STEPS,
  ZERO_ACTION_COUNTERS,
  buildTutorialSnapshot,
  clampTutorialBaseline,
  counterKeyForHistoryKind,
  type TutorialSnapshot,
} from "../utils/tutorialSteps";

/**
 * Controller for the interactive tutorial (see utils/tutorialSteps.ts for the
 * step definitions and the design lineage). Owns the step state machine:
 * per-step baselines, the brief "step complete" beat before auto-advancing,
 * undo-aware re-verification, and localStorage persistence so the tour
 * auto-offers only on a first visit.
 */

export const TUTORIAL_STORAGE_KEY = "piperDraw.tutorial";

/** Confirmation beat: how long the "✓ done" state shows before advancing. */
const ADVANCE_DELAY_MS = 700;

interface TutorialStore {
  active: boolean;
  stepIndex: number;
  /** Highest step reached, used to make earlier steps reviewable without repeating them. */
  furthestStepIndex: number;
  /** True during the completion beat between finishing a step and advancing. */
  celebrating: boolean;
  start: () => void;
  /** Starts the tour unless a previous visit completed or dismissed it. */
  maybeAutoStart: () => void;
  /** Advance: primary button on passive steps, Skip on action steps. */
  advance: () => void;
  /** Return to the previous step without discarding forward progress. */
  back: () => void;
  /** Record pressing Compute in the stabilizer-flows panel. */
  recordFlowCompute: () => void;
  /** Record pressing Share link in the File menu. */
  recordShareLink: () => void;
  dismiss: () => void;
}

// --- Module-level controller state (not React-subscribed) -------------------

let baseline: TutorialSnapshot | null = null;
/** Captured when a step completes so edits made during the beat still count. */
let pendingBaseline: TutorialSnapshot | null = null;
let advanceTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Monotonic action tallies. Derived from live transitions (a newly pushed
 * undo command / a validationStore run) rather than by tallying the capped
 * undo history, which would pin counts once the history window saturates.
 */
const counters = { ...ZERO_ACTION_COUNTERS };
let lastValidationStatus = useValidationStore.getState().status;
let lastHistoryLen = useBlockStore.getState().history.length;
let lastHistoryTail: { kind: string } | null =
  useBlockStore.getState().history.at(-1) ?? null;

/**
 * Increment a counter when a NEW command lands on the history tail. A push
 * grows the history (or, at the MAX_HISTORY cap, keeps the length and swaps
 * the tail); an undo shrinks it — never counted. A redo re-pushes the same
 * command and counts again, which is fine: the user did re-perform the action.
 */
function trackHistoryCounters(history: ReadonlyArray<{ kind: string }>): void {
  const tail = history.at(-1) ?? null;
  const pushed =
    tail !== null &&
    tail !== lastHistoryTail &&
    history.length >= lastHistoryLen;
  lastHistoryLen = history.length;
  lastHistoryTail = tail;
  if (!pushed) return;
  const key = counterKeyForHistoryKind(tail.kind);
  if (key) counters[key]++;
}

function storedTutorialState(): string | null {
  try {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY);
  } catch {
    // Auto-starting on every visit would be worse than never auto-starting,
    // since a dismissal could not be remembered either.
    return "unavailable";
  }
}

function saveTutorialState(value: "completed" | "dismissed"): void {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, value);
  } catch {
    // The tour still works for this page when browser storage is unavailable.
  }
}

function currentSnapshot(): TutorialSnapshot {
  return buildTutorialSnapshot(useBlockStore.getState(), counters);
}

function cancelPendingAdvance(): void {
  if (advanceTimer === null) return;
  clearTimeout(advanceTimer);
  advanceTimer = null;
}

// The factory intentionally keeps the transition helpers together so timer,
// baseline, and navigation changes remain one state machine.
// eslint-disable-next-line max-lines-per-function
export const useTutorialStore = create<TutorialStore>((set, get) => {
  function stepIsComplete(): boolean {
    const step = TUTORIAL_STEPS[get().stepIndex];
    if (!step?.isComplete || baseline === null) return false;
    const now = currentSnapshot();
    baseline = clampTutorialBaseline(baseline, now);
    return step.isComplete(now, baseline);
  }

  function advanceToNext(): void {
    cancelPendingAdvance();
    const { stepIndex, furthestStepIndex } = get();
    if (stepIndex >= TUTORIAL_STEPS.length - 1) {
      baseline = null;
      pendingBaseline = null;
      saveTutorialState("completed");
      set({ active: false, celebrating: false });
      return;
    }
    baseline = pendingBaseline ?? currentSnapshot();
    pendingBaseline = null;
    const nextStepIndex = stepIndex + 1;
    set({
      stepIndex: nextStepIndex,
      furthestStepIndex: Math.max(furthestStepIndex, nextStepIndex),
      celebrating: false,
    });
    // The user may already have completed this step during the previous
    // step's confirmation beat, when store-driven checks were paused.
    checkCompletion();
  }

  /** An undo during the beat can invalidate the step; re-verify before moving on. */
  function confirmAdvance(): void {
    advanceTimer = null;
    if (stepIsComplete()) {
      advanceToNext();
      return;
    }
    pendingBaseline = null;
    set({ celebrating: false });
  }

  /** Shows a brief confirmation beat on the card before moving on. */
  function scheduleAdvance(): void {
    if (advanceTimer !== null) return;
    pendingBaseline = currentSnapshot();
    set({ celebrating: true });
    advanceTimer = setTimeout(confirmAdvance, ADVANCE_DELAY_MS);
  }

  function checkCompletion(): void {
    const state = get();
    if (!state.active) return;
    // Earlier steps are being reviewed; their actions have already been
    // completed or skipped, so they advance with Next instead of re-firing.
    if (state.stepIndex < state.furthestStepIndex) return;
    if (advanceTimer !== null) return;
    if (stepIsComplete()) scheduleAdvance();
  }

  // Completion is driven by real document edits: re-check on every block-store
  // change, and count Verify attempts from validationStore's status stream.
  useBlockStore.subscribe((s) => {
    trackHistoryCounters(s.history);
    checkCompletion();
  });
  useValidationStore.subscribe((s) => {
    if (s.status === "loading" && lastValidationStatus !== "loading") counters.verifyRuns++;
    lastValidationStatus = s.status;
    checkCompletion();
  });

  return {
    active: false,
    stepIndex: 0,
    furthestStepIndex: 0,
    celebrating: false,

    start: () => {
      cancelPendingAdvance();
      pendingBaseline = null;
      baseline = currentSnapshot();
      set({ active: true, stepIndex: 0, furthestStepIndex: 0, celebrating: false });
    },

    maybeAutoStart: () => {
      // Never restart a tour that's already running — the HelpPanel's onClose
      // calls this on every close, including mid-tour visits to the manual.
      if (get().active) return;
      if (storedTutorialState() === null) get().start();
    },

    advance: () => advanceToNext(),

    back: () => {
      // The current step is already complete during the confirmation beat.
      // Keep that pending completion intact until it advances.
      if (get().celebrating) return;
      cancelPendingAdvance();
      pendingBaseline = null;
      const { stepIndex } = get();
      if (stepIndex === 0) return;
      baseline = currentSnapshot();
      set({ stepIndex: stepIndex - 1, celebrating: false });
    },

    recordFlowCompute: () => {
      counters.flowComputes++;
      checkCompletion();
    },

    recordShareLink: () => {
      counters.shareLinks++;
      checkCompletion();
    },

    dismiss: () => {
      cancelPendingAdvance();
      baseline = null;
      pendingBaseline = null;
      saveTutorialState("dismissed");
      set({ active: false, celebrating: false });
    },
  };
});
