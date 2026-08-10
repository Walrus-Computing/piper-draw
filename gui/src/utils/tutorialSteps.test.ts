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
  const s = TUTORIAL_STEPS.find((st) => st.id === id);
  if (!s) throw new Error(`no step ${id}`);
  return s;
}

describe("buildTutorialSnapshot", () => {
  it("splits blocks into cubes and pipes and carries the action counters", () => {
    const blocks = new Map<string, Block>([
      ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "ZXZ" }],
      ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OXZ" }],
      ["3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "XXZ" }],
    ]);
    const s = buildTutorialSnapshot(
      source({ blocks, portPositions: new Set(["6,0,0"]) }),
      { ...ZERO_ACTION_COUNTERS, buildSteps: 2, verifyRuns: 2 },
    );
    expect(s.cubes).toBe(2);
    expect(s.pipes).toBe(1);
    expect(s.blocks).toBe(3);
    expect(s.ports).toBe(1);
    expect(s.buildSteps).toBe(2);
    expect(s.verifyRuns).toBe(2);
  });
});

describe("counterKeyForHistoryKind", () => {
  it("maps the tutorial-relevant undo kinds and ignores the rest", () => {
    expect(counterKeyForHistoryKind("edit-type-cycle")).toBe("typeCycles");
    expect(counterKeyForHistoryKind("build-step")).toBe("buildSteps");
    expect(counterKeyForHistoryKind("load")).toBe("sceneLoads");
    expect(counterKeyForHistoryKind("bulk-add")).toBe("bulkAdds");
    expect(counterKeyForHistoryKind("add-port")).toBe("portAdds");
    expect(counterKeyForHistoryKind("port")).toBe("portAdds");
    expect(counterKeyForHistoryKind("add")).toBeNull();
    expect(counterKeyForHistoryKind("remove")).toBeNull();
  });
});

describe("clampTutorialBaseline", () => {
  it("follows numeric totals down (undo/clear) and never up", () => {
    const base = snap({ cubes: 5, pipes: 2 });
    const now = snap({ cubes: 3, pipes: 4 });
    const clamped = clampTutorialBaseline(base, now);
    expect(clamped.cubes).toBe(3); // followed down
    expect(clamped.pipes).toBe(2); // not raised
  });

  it("re-arms boolean baselines when the state falls back to false", () => {
    // Flows panel open at step start, then closed by the user: the baseline
    // must follow it down so reopening completes the step.
    const base = snap({ flowsOpen: true });
    const clamped = clampTutorialBaseline(base, snap({ flowsOpen: false }));
    expect(clamped.flowsOpen).toBe(false);
    expect(step("flows").isComplete!(snap({ flowsOpen: true }), clamped)).toBe(true);
  });
});

describe("step predicates", () => {
  it("welcome and done are passive (no predicate)", () => {
    expect(step("welcome").isComplete).toBeUndefined();
    expect(step("done").isComplete).toBeUndefined();
  });

  it("place-cube completes when a cube is added", () => {
    const base = snap();
    expect(step("place-cube").isComplete!(snap({ cubes: 1 }), base)).toBe(true);
    expect(step("place-cube").isComplete!(snap({ pipes: 1 }), base)).toBe(false);
  });

  it("keyboard-build needs two build steps", () => {
    const base = snap();
    const p = step("keyboard-build").isComplete!;
    expect(p(snap({ buildSteps: 1 }), base)).toBe(false);
    expect(p(snap({ buildSteps: 2 }), base)).toBe(true);
  });

  it("add-port completes on an explicit port or an add-port history entry", () => {
    const base = snap();
    const p = step("add-port").isComplete!;
    expect(p(snap({ ports: 1 }), base)).toBe(true);
    expect(p(snap({ portAdds: 1 }), base)).toBe(true);
    expect(p(snap(), base)).toBe(false);
  });

  it("verify completes on a new verify attempt", () => {
    const base = snap({ verifyRuns: 3 });
    expect(step("verify").isComplete!(snap({ verifyRuns: 4 }), base)).toBe(true);
    expect(step("verify").isComplete!(snap({ verifyRuns: 3 }), base)).toBe(false);
  });

  it("load-template accepts Load (scene load) or Insert (bulk add)", () => {
    const base = snap();
    const p = step("load-template").isComplete!;
    expect(p(snap({ sceneLoads: 1 }), base)).toBe(true);
    expect(p(snap({ bulkAdds: 1 }), base)).toBe(true);
  });

  it("flows requires freshly opening an analysis panel", () => {
    const p = step("flows").isComplete!;
    expect(p(snap({ flowsOpen: true }), snap())).toBe(true);
    // Already open at step start → must be opened fresh.
    expect(p(snap({ flowsOpen: true }), snap({ flowsOpen: true }))).toBe(false);
  });

  it("every highlight target is a known data-tutorial anchor", () => {
    const known = new Set([
      "select-tool", "blocks-palette", "pipes-palette", "port-tool",
      "mode-pill", "file-menu", "analyze-menu",
    ]);
    for (const s of TUTORIAL_STEPS) {
      for (const h of s.highlights) {
        expect(known.has(h), `${s.id} highlights unknown target ${h}`).toBe(true);
      }
    }
  });
});
