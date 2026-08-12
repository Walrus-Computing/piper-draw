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

export const TUTORIAL_STORAGE_KEY = "piperDraw.tutorial";
const ADVANCE_DELAY_MS = 700;

interface TutorialStore {
  active: boolean;
  stepIndex: number;
  furthestStepIndex: number;
  celebrating: boolean;
  start: () => void;
  maybeAutoStart: () => void;
  advance: () => void;
  back: () => void;
  recordFlowCompute: () => void;
  recordShareLink: () => void;
  dismiss: () => void;
}

let baseline: TutorialSnapshot | null = null;
let pendingBaseline: TutorialSnapshot | null = null;
let advanceTimer: ReturnType<typeof setTimeout> | null = null;
const counters = { ...ZERO_ACTION_COUNTERS };
let lastValidationStatus = useValidationStore.getState().status;
let lastHistoryLen = useBlockStore.getState().history.length;
let lastHistoryTail: { kind: string } | null =
  useBlockStore.getState().history.at(-1) ?? null;

function trackHistoryCounters(history: ReadonlyArray<{ kind: string }>): void {
  const tail = history.at(-1) ?? null;
  const pushed =
    tail !== null
    && tail !== lastHistoryTail
    && history.length >= lastHistoryLen;
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
    return "unavailable";
  }
}

function saveTutorialState(value: "completed" | "dismissed"): void {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, value);
  } catch {
    // The tutorial still works for this page without browser storage.
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

// The state machine owns baselines and the short completion beat between steps.
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
    checkCompletion();
  }

  function confirmAdvance(): void {
    advanceTimer = null;
    if (stepIsComplete()) {
      advanceToNext();
      return;
    }
    pendingBaseline = null;
    set({ celebrating: false });
  }

  function scheduleAdvance(): void {
    if (advanceTimer !== null) return;
    pendingBaseline = currentSnapshot();
    set({ celebrating: true });
    advanceTimer = setTimeout(confirmAdvance, ADVANCE_DELAY_MS);
  }

  function checkCompletion(): void {
    const state = get();
    if (!state.active || state.stepIndex < state.furthestStepIndex) return;
    if (advanceTimer !== null) return;
    if (stepIsComplete()) scheduleAdvance();
  }

  useBlockStore.subscribe((state) => {
    trackHistoryCounters(state.history);
    checkCompletion();
  });
  useValidationStore.subscribe((state) => {
    if (state.status === "loading" && lastValidationStatus !== "loading") {
      counters.verifyRuns++;
    }
    lastValidationStatus = state.status;
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
      if (get().active) return;
      if (storedTutorialState() === null) get().start();
    },

    advance: () => advanceToNext(),

    back: () => {
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
