import { describe, expect, it } from "vitest";
import {
  TUTORIAL_STEPS,
  ZERO_ACTION_COUNTERS,
  buildTutorialSnapshot,
  clampTutorialBaseline,
  counterKeyForHistoryKind,
  type TutorialSnapshot,
  type TutorialSnapshotSource,
} from "./tutorialSteps";
import type { Block } from "../types";

function source(overrides: Partial<TutorialSnapshotSource> = {}): TutorialSnapshotSource {
  return {
    blocks: new Map<string, Block>(),
    portPositions: new Set<string>(),
    selectedKeys: new Set<string>(),
    mode: "edit",
    flowsPanelOpen: false,
    zxPanelOpen: false,
    ...overrides,
  };
}

function snap(overrides: Partial<TutorialSnapshot> = {}): TutorialSnapshot {
  return {
    ...buildTutorialSnapshot(source(), ZERO_ACTION_COUNTERS),
    ...overrides,
  };
}

function step(id: string) {
  const result = TUTORIAL_STEPS.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`no step ${id}`);
  return result;
}

describe("buildTutorialSnapshot", () => {
  it("splits blocks into cubes and pipes and carries action counters", () => {
    const blocks = new Map<string, Block>([
      ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "ZXZ" }],
      ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OXZ" }],
      ["3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "XXZ" }],
    ]);
    const result = buildTutorialSnapshot(
      source({ blocks, portPositions: new Set(["6,0,0"]) }),
      { ...ZERO_ACTION_COUNTERS, buildSteps: 2, verifyRuns: 1, shareLinks: 1 },
    );
    expect(result.cubes).toBe(2);
    expect(result.pipes).toBe(1);
    expect(result.blocks).toBe(3);
    expect(result.ports).toBe(1);
    expect(result.buildSteps).toBe(2);
    expect(result.verifyRuns).toBe(1);
    expect(result.shareLinks).toBe(1);
  });
});

describe("counterKeyForHistoryKind", () => {
  it("maps tutorial actions and ignores unrelated undo commands", () => {
    expect(counterKeyForHistoryKind("edit-type-cycle")).toBe("typeCycles");
    expect(counterKeyForHistoryKind("build-step")).toBe("buildSteps");
    expect(counterKeyForHistoryKind("load")).toBe("sceneLoads");
    expect(counterKeyForHistoryKind("bulk-add")).toBe("bulkAdds");
    expect(counterKeyForHistoryKind("add")).toBeNull();
  });
});

describe("clampTutorialBaseline", () => {
  it("follows totals down after undo or clear, but never raises them", () => {
    const clamped = clampTutorialBaseline(
      snap({ cubes: 5, pipes: 2 }),
      snap({ cubes: 3, pipes: 4 }),
    );
    expect(clamped.cubes).toBe(3);
    expect(clamped.pipes).toBe(2);
  });

  it("re-arms a panel step after the panel closes", () => {
    const clamped = clampTutorialBaseline(
      snap({ flowsOpen: true }),
      snap({ flowsOpen: false }),
    );
    expect(clamped.flowsOpen).toBe(false);
    expect(step("flows").isComplete!(snap({ flowsOpen: true }), clamped)).toBe(true);
  });
});

describe("tutorial steps for the reorganized toolbar", () => {
  it("requires real actions for every interactive step", () => {
    expect(step("place-cube").isComplete!(snap({ cubes: 1 }), snap())).toBe(true);
    expect(step("draw-pipe").isComplete!(snap({ pipes: 1 }), snap())).toBe(true);
    expect(step("keyboard-build").isComplete!(snap({ buildSteps: 1 }), snap())).toBe(false);
    expect(step("keyboard-build").isComplete!(snap({ buildSteps: 2 }), snap())).toBe(true);
    expect(step("verify").isComplete!(snap({ verifyRuns: 1 }), snap())).toBe(true);
    expect(step("load-example").isComplete!(snap({ sceneLoads: 1 }), snap())).toBe(true);
    expect(step("load-example").isComplete!(snap({ bulkAdds: 1 }), snap())).toBe(true);
    expect(step("flows").isComplete!(snap({ flowsOpen: true }), snap())).toBe(true);
    expect(step("compute-flows").isComplete!(snap({ flowComputes: 1 }), snap())).toBe(true);
    expect(step("zx").isComplete!(snap({ zxOpen: true }), snap())).toBe(true);
    expect(step("share-link").isComplete!(snap({ shareLinks: 1 }), snap())).toBe(true);
  });

  it("uses anchors exposed by the new toolbar", () => {
    const known = new Set([
      "select-tool",
      "blocks-palette",
      "pipes-palette",
      "build-mode",
      "examples-button",
      "analyze-menu",
      "flows-menu-item",
      "flows-compute",
      "zx-menu-item",
      "export-menu",
      "share-link",
    ]);
    for (const tutorialStep of TUTORIAL_STEPS) {
      for (const highlight of tutorialStep.highlights) {
        expect(known.has(highlight), `${tutorialStep.id} highlights ${highlight}`).toBe(true);
      }
    }
  });
});
