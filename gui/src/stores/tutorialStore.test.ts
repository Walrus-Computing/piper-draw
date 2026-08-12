import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTutorialStore, TUTORIAL_STORAGE_KEY } from "./tutorialStore";
import { useBlockStore } from "./blockStore";
import { useValidationStore } from "./validationStore";
import { TUTORIAL_STEPS } from "../utils/tutorialSteps";

const ADVANCE_DELAY_MS = 700;

function stepIndexOf(id: string): number {
  const i = TUTORIAL_STEPS.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`no step ${id}`);
  return i;
}

function resetBlockStore() {
  useBlockStore.setState({
    blocks: new Map(),
    spatialIndex: new Map(),
    hiddenFaces: new Map(),
    history: [],
    future: [],
    mode: "edit",
    cubeType: "XZZ",
    pipeVariant: null,
    armedTool: "cube",
    xHeld: false,
    portWarning: null,
    hoveredGridPos: null,
    hoveredBlockType: null,
    hoveredInvalid: false,
    selectedKeys: new Set(),
    selectedPortPositions: new Set(),
    portPositions: new Set(),
    selectionPivot: null,
    undeterminedCubes: new Map(),
    freeBuild: false,
    clipboard: null,
    flowsPanelOpen: false,
    zxPanelOpen: false,
  });
}

/** Advance the tour to the step with the given id (Skip works on any step). */
function driveTo(id: string) {
  useTutorialStore.getState().start();
  const target = stepIndexOf(id);
  while (useTutorialStore.getState().stepIndex < target) {
    useTutorialStore.getState().advance();
  }
}

// This jsdom environment exposes no localStorage (opaque origin); install a
// Map-backed stub so persistence behaviour is testable and hermetic.
const stubStorage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => stubStorage.get(k) ?? null,
    setItem: (k: string, v: string) => void stubStorage.set(k, String(v)),
    removeItem: (k: string) => void stubStorage.delete(k),
    clear: () => stubStorage.clear(),
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  resetBlockStore();
  // End any tour a prior test left running, then clear the dismissal it wrote.
  useTutorialStore.getState().dismiss();
  stubStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tutorialStore", () => {
  it("starts inactive on the welcome step and start() activates it", () => {
    expect(useTutorialStore.getState().active).toBe(false);
    useTutorialStore.getState().start();
    const s = useTutorialStore.getState();
    expect(s.active).toBe(true);
    expect(s.stepIndex).toBe(0);
  });

  it("completes place-cube by really placing a cube: beat, then auto-advance", () => {
    driveTo("place-cube");
    useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
    // Completion detected → celebration beat, not an instant advance.
    expect(useTutorialStore.getState().celebrating).toBe(true);
    expect(useTutorialStore.getState().stepIndex).toBe(stepIndexOf("place-cube"));
    vi.advanceTimersByTime(ADVANCE_DELAY_MS);
    const s = useTutorialStore.getState();
    expect(s.celebrating).toBe(false);
    expect(s.stepIndex).toBe(stepIndexOf("place-cube") + 1);
  });

  it("an undo during the beat re-verifies and stays on the step", () => {
    driveTo("place-cube");
    useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
    expect(useTutorialStore.getState().celebrating).toBe(true);
    useBlockStore.getState().undo();
    vi.advanceTimersByTime(ADVANCE_DELAY_MS);
    const s = useTutorialStore.getState();
    expect(s.stepIndex).toBe(stepIndexOf("place-cube"));
    expect(s.celebrating).toBe(false);
    // The step still completes normally afterwards.
    useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
    vi.advanceTimersByTime(ADVANCE_DELAY_MS);
    expect(useTutorialStore.getState().stepIndex).toBe(stepIndexOf("place-cube") + 1);
  });

  it("clamps the baseline down: undo before acting does not strand the step", () => {
    // Seed one cube, then start (baseline cubes=1), then undo it (cubes=0).
    useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
    driveTo("place-cube");
    useBlockStore.getState().undo();
    // One new cube on the now-smaller document must complete the step.
    useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
    expect(useTutorialStore.getState().celebrating).toBe(true);
  });

  it("counts verify attempts from validationStore's status stream", () => {
    driveTo("verify");
    useValidationStore.setState({ status: "loading" });
    expect(useTutorialStore.getState().celebrating).toBe(true);
    vi.advanceTimersByTime(ADVANCE_DELAY_MS);
    expect(useTutorialStore.getState().stepIndex).toBe(stepIndexOf("verify") + 1);
    useValidationStore.setState({ status: "idle" });
  });

  it("goes back to review a completed step, then returns with Next", () => {
    driveTo("verify");
    const verifyIndex = stepIndexOf("verify");
    useTutorialStore.getState().back();
    expect(useTutorialStore.getState().stepIndex).toBe(verifyIndex - 1);
    expect(useTutorialStore.getState().furthestStepIndex).toBe(verifyIndex);

    useTutorialStore.getState().advance();
    expect(useTutorialStore.getState().stepIndex).toBe(verifyIndex);
    expect(useTutorialStore.getState().furthestStepIndex).toBe(verifyIndex);
  });

  it("counts pressing Compute in the stabilizer-flows panel", () => {
    driveTo("compute-flows");
    useTutorialStore.getState().recordFlowCompute();
    expect(useTutorialStore.getState().celebrating).toBe(true);
    vi.advanceTimersByTime(ADVANCE_DELAY_MS);
    expect(useTutorialStore.getState().stepIndex).toBe(stepIndexOf("zx"));
  });

  it("includes opening ZX and pressing Share link", () => {
    driveTo("zx");
    useBlockStore.setState({ zxPanelOpen: true });
    expect(useTutorialStore.getState().celebrating).toBe(true);
    vi.advanceTimersByTime(ADVANCE_DELAY_MS);
    expect(useTutorialStore.getState().stepIndex).toBe(stepIndexOf("share-link"));

    useTutorialStore.getState().recordShareLink();
    expect(useTutorialStore.getState().celebrating).toBe(true);
  });

  it("finishing the last step persists 'completed' and deactivates", () => {
    driveTo("done");
    useTutorialStore.getState().advance(); // Finish
    expect(useTutorialStore.getState().active).toBe(false);
    expect(window.localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe("completed");
  });

  it("maybeAutoStart never resets a tour already in progress", () => {
    // The HelpPanel's onClose calls maybeAutoStart on EVERY close; a mid-tour
    // visit to the manual must not restart the tour at step 0.
    driveTo("verify");
    useTutorialStore.getState().maybeAutoStart();
    expect(useTutorialStore.getState().stepIndex).toBe(stepIndexOf("verify"));
    expect(useTutorialStore.getState().active).toBe(true);
  });

  it("dismiss persists and maybeAutoStart honors it; first visit auto-starts", () => {
    useTutorialStore.getState().maybeAutoStart();
    expect(useTutorialStore.getState().active).toBe(true); // first visit
    useTutorialStore.getState().dismiss();
    expect(window.localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe("dismissed");
    useTutorialStore.getState().maybeAutoStart();
    expect(useTutorialStore.getState().active).toBe(false);
  });
});
