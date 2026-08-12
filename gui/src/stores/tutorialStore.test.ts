import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTutorialStore, TUTORIAL_STORAGE_KEY } from "./tutorialStore";
import { useBlockStore } from "./blockStore";
import { useValidationStore } from "./validationStore";
import { TUTORIAL_STEPS } from "../utils/tutorialSteps";

const ADVANCE_DELAY_MS = 700;

function stepIndexOf(id: string): number {
  const index = TUTORIAL_STEPS.findIndex((step) => step.id === id);
  if (index < 0) throw new Error(`no step ${id}`);
  return index;
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

function driveTo(id: string) {
  useTutorialStore.getState().start();
  const target = stepIndexOf(id);
  while (useTutorialStore.getState().stepIndex < target) {
    useTutorialStore.getState().advance();
  }
}

const stubStorage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => stubStorage.get(key) ?? null,
    setItem: (key: string, value: string) => void stubStorage.set(key, String(value)),
    removeItem: (key: string) => void stubStorage.delete(key),
    clear: () => stubStorage.clear(),
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  resetBlockStore();
  useTutorialStore.getState().dismiss();
  stubStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tutorialStore", () => {
  it("completes a real placement after the confirmation beat", () => {
    driveTo("place-cube");
    useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
    expect(useTutorialStore.getState().celebrating).toBe(true);
    vi.advanceTimersByTime(ADVANCE_DELAY_MS);
    expect(useTutorialStore.getState().stepIndex).toBe(stepIndexOf("draw-pipe"));
  });

  it("re-verifies when an action is undone during the confirmation beat", () => {
    driveTo("place-cube");
    useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
    useBlockStore.getState().undo();
    vi.advanceTimersByTime(ADVANCE_DELAY_MS);
    expect(useTutorialStore.getState().stepIndex).toBe(stepIndexOf("place-cube"));
    expect(useTutorialStore.getState().celebrating).toBe(false);
  });

  it("counts validation, flow-compute, and share actions", () => {
    driveTo("verify");
    useValidationStore.setState({ status: "loading" });
    expect(useTutorialStore.getState().celebrating).toBe(true);
    useValidationStore.setState({ status: "idle" });

    driveTo("compute-flows");
    useTutorialStore.getState().recordFlowCompute();
    expect(useTutorialStore.getState().celebrating).toBe(true);

    driveTo("share-link");
    useTutorialStore.getState().recordShareLink();
    expect(useTutorialStore.getState().celebrating).toBe(true);
  });

  it("tracks opening the analysis panels", () => {
    driveTo("flows");
    useBlockStore.setState({ flowsPanelOpen: true });
    expect(useTutorialStore.getState().celebrating).toBe(true);

    driveTo("zx");
    useBlockStore.setState({ zxPanelOpen: true });
    expect(useTutorialStore.getState().celebrating).toBe(true);
  });

  it("persists completion and dismissal", () => {
    driveTo("done");
    useTutorialStore.getState().advance();
    expect(useTutorialStore.getState().active).toBe(false);
    expect(window.localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe("completed");

    stubStorage.clear();
    useTutorialStore.getState().maybeAutoStart();
    expect(useTutorialStore.getState().active).toBe(true);
    useTutorialStore.getState().dismiss();
    expect(window.localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe("dismissed");
  });

  it("does not restart an active tutorial when the help modal closes", () => {
    driveTo("verify");
    useTutorialStore.getState().maybeAutoStart();
    expect(useTutorialStore.getState().stepIndex).toBe(stepIndexOf("verify"));
  });
});
