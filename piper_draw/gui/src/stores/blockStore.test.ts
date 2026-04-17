import { describe, expect, it, beforeEach } from "vitest";
import { useBlockStore } from "./blockStore";
import type { Block } from "../types";

function reset() {
  useBlockStore.setState({
    blocks: new Map(),
    spatialIndex: new Map(),
    hiddenFaces: new Map(),
    history: [],
    future: [],
    mode: "place",
    cubeType: "XZZ",
    pipeVariant: null,
    placePort: false,
    portWarning: null,
    hoveredGridPos: null,
    hoveredBlockType: null,
    hoveredInvalid: false,
    selectedKeys: new Set(),
  });
}

describe("blockStore", () => {
  beforeEach(reset);

  describe("addBlock", () => {
    it("adds a cube at a valid position", () => {
      const { addBlock } = useBlockStore.getState();
      addBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(1);
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XZZ");
    });

    it("rejects placement at an invalid position for a cube", () => {
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(0);
    });

    it("skips placement of the same block type at an occupied position", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(1);
      expect(useBlockStore.getState().history.length).toBe(1);
    });

    it("replaces an existing block with a different valid type", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XZZ");
      useBlockStore.setState({ cubeType: "ZXZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(1);
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("ZXZ");
    });

    it("undo after replace restores the original block", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ cubeType: "ZXZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("ZXZ");
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XZZ");
    });

    it("redo after undone replace re-applies the replacement", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ cubeType: "ZXZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().undo();
      useBlockStore.getState().redo();
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("ZXZ");
    });

    it("resolves pipe variant to correct PipeType based on position", () => {
      useBlockStore.setState({ pipeVariant: "ZX" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      const block = useBlockStore.getState().blocks.get("1,0,0");
      expect(block?.type).toBe("OZX");
    });

    it("rejects pipe placement when variant cannot resolve", () => {
      useBlockStore.setState({ pipeVariant: "ZX" });
      // (0,0,0) is a block position, not a pipe position
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(0);
    });

    it("pushes to history on successful add", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().history.length).toBe(1);
    });

    it("does not push to history on rejected add", () => {
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      expect(useBlockStore.getState().history.length).toBe(0);
    });

    it("clears future on new add", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().future.length).toBe(1);
      useBlockStore.getState().addBlock({ x: 6, y: 0, z: 0 });
      expect(useBlockStore.getState().future.length).toBe(0);
    });
  });

  describe("removeBlock", () => {
    it("removes an existing block", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().removeBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(0);
    });

    it("is a no-op for a non-existent position", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const histBefore = useBlockStore.getState().history.length;
      useBlockStore.getState().removeBlock({ x: 3, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(1);
      expect(useBlockStore.getState().history.length).toBe(histBefore);
    });

    it("cascades attached pipes when removing a cube with ≥2 pipes", () => {
      const incoming = new Map<string, Block>([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
        ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OZX" }],
        ["0,1,0", { pos: { x: 0, y: 1, z: 0 }, type: "ZOX" }],
      ]);
      useBlockStore.getState().loadBlocks(incoming);
      useBlockStore.getState().removeBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(0);
    });

    it("does not cascade when removing a cube with <2 pipes", () => {
      const incoming = new Map<string, Block>([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
        ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OZX" }],
      ]);
      useBlockStore.getState().loadBlocks(incoming);
      useBlockStore.getState().removeBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(1);
      expect(useBlockStore.getState().blocks.has("1,0,0")).toBe(true);
    });

    it("undoes a cube-with-pipes cascade as a single step", () => {
      const incoming = new Map<string, Block>([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
        ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OZX" }],
        ["0,1,0", { pos: { x: 0, y: 1, z: 0 }, type: "ZOX" }],
      ]);
      useBlockStore.getState().loadBlocks(incoming);
      const histBefore = useBlockStore.getState().history.length;
      useBlockStore.getState().removeBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().history.length).toBe(histBefore + 1);
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.size).toBe(3);
    });
  });

  describe("undo / redo", () => {
    it("undoes the last add", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.size).toBe(0);
    });

    it("redoes after undo", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().undo();
      useBlockStore.getState().redo();
      expect(useBlockStore.getState().blocks.size).toBe(1);
    });

    it("undo is a no-op when history is empty", () => {
      const before = useBlockStore.getState().blocks;
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks).toBe(before);
    });

    it("redo is a no-op when future is empty", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const before = useBlockStore.getState().blocks;
      useBlockStore.getState().redo();
      expect(useBlockStore.getState().blocks).toBe(before);
    });

    it("caps history at MAX_HISTORY (100)", () => {
      for (let i = 0; i < 110; i++) {
        useBlockStore.getState().addBlock({ x: i * 3, y: 0, z: 0 });
      }
      expect(useBlockStore.getState().history.length).toBe(100);
    });
  });

  describe("clearAll", () => {
    it("clears all blocks", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().clearAll();
      expect(useBlockStore.getState().blocks.size).toBe(0);
    });

    it("is a no-op when already empty", () => {
      const histBefore = useBlockStore.getState().history.length;
      useBlockStore.getState().clearAll();
      expect(useBlockStore.getState().history.length).toBe(histBefore);
    });

    it("can be undone", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().clearAll();
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.size).toBe(1);
    });
  });

  describe("selectBlock", () => {
    it("selects a single block", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      expect(useBlockStore.getState().selectedKeys.size).toBe(1);
      expect(useBlockStore.getState().selectedKeys.has("0,0,0")).toBe(true);
    });

    it("replaces selection when additive is false", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      useBlockStore.getState().selectBlock({ x: 3, y: 0, z: 0 }, false);
      expect(useBlockStore.getState().selectedKeys.size).toBe(1);
      expect(useBlockStore.getState().selectedKeys.has("3,0,0")).toBe(true);
    });

    it("adds to selection when additive is true", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      useBlockStore.getState().selectBlock({ x: 3, y: 0, z: 0 }, true);
      expect(useBlockStore.getState().selectedKeys.size).toBe(2);
    });

    it("toggles off when shift-clicking an already-selected block", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, true);
      expect(useBlockStore.getState().selectedKeys.size).toBe(0);
    });

    it("is a no-op for a non-existent block", () => {
      useBlockStore.getState().selectBlock({ x: 99, y: 0, z: 0 }, false);
      expect(useBlockStore.getState().selectedKeys.size).toBe(0);
    });
  });

  describe("clearSelection", () => {
    it("clears all selected keys", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      useBlockStore.getState().clearSelection();
      expect(useBlockStore.getState().selectedKeys.size).toBe(0);
    });

    it("is a no-op when nothing is selected", () => {
      const before = useBlockStore.getState().selectedKeys;
      useBlockStore.getState().clearSelection();
      expect(useBlockStore.getState().selectedKeys).toBe(before);
    });
  });

  describe("selectAll", () => {
    it("selects all blocks", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      expect(useBlockStore.getState().selectedKeys.size).toBe(2);
    });

    it("is a no-op when no blocks exist", () => {
      const before = useBlockStore.getState().selectedKeys;
      useBlockStore.getState().selectAll();
      expect(useBlockStore.getState().selectedKeys).toBe(before);
    });
  });

  describe("deleteSelected", () => {
    it("removes all selected blocks", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().deleteSelected();
      expect(useBlockStore.getState().blocks.size).toBe(0);
      expect(useBlockStore.getState().selectedKeys.size).toBe(0);
    });

    it("pushes a single bulk-remove command to history", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      const histBefore = useBlockStore.getState().history.length;
      useBlockStore.getState().selectAll();
      useBlockStore.getState().deleteSelected();
      expect(useBlockStore.getState().history.length).toBe(histBefore + 1);
    });

    it("can be undone to restore all deleted blocks", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().deleteSelected();
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.size).toBe(2);
    });

    it("can be redone after undo", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().deleteSelected();
      useBlockStore.getState().undo();
      useBlockStore.getState().redo();
      expect(useBlockStore.getState().blocks.size).toBe(0);
    });

    it("is a no-op when nothing is selected", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const histBefore = useBlockStore.getState().history.length;
      useBlockStore.getState().deleteSelected();
      expect(useBlockStore.getState().blocks.size).toBe(1);
      expect(useBlockStore.getState().history.length).toBe(histBefore);
    });

    it("skips stale keys that no longer exist in blocks", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().removeBlock({ x: 0, y: 0, z: 0 });
      // selectedKeys still has "0,0,0" but block was removed
      useBlockStore.getState().deleteSelected();
      expect(useBlockStore.getState().blocks.size).toBe(0);
    });

    it("cascades attached pipes when deleting a selected cube with ≥2 pipes", () => {
      const incoming = new Map<string, Block>([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
        ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OZX" }],
        ["0,1,0", { pos: { x: 0, y: 1, z: 0 }, type: "ZOX" }],
      ]);
      useBlockStore.getState().loadBlocks(incoming);
      useBlockStore.setState({ selectedKeys: new Set(["0,0,0"]) });
      useBlockStore.getState().deleteSelected();
      expect(useBlockStore.getState().blocks.size).toBe(0);
    });

    it("cascade-delete undoes in a single step", () => {
      const incoming = new Map<string, Block>([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
        ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OZX" }],
        ["0,1,0", { pos: { x: 0, y: 1, z: 0 }, type: "ZOX" }],
      ]);
      useBlockStore.getState().loadBlocks(incoming);
      useBlockStore.setState({ selectedKeys: new Set(["0,0,0"]) });
      useBlockStore.getState().deleteSelected();
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.size).toBe(3);
    });
  });

  describe("convertBlockToPort", () => {
    it("removes a standalone cube (0 pipes)", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().convertBlockToPort({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(0);
      expect(useBlockStore.getState().portWarning).toBeNull();
    });

    it("removes a cube with 1 attached pipe (leaving the pipe)", () => {
      const incoming = new Map<string, Block>([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
        ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OZX" }],
      ]);
      useBlockStore.getState().loadBlocks(incoming);
      useBlockStore.getState().convertBlockToPort({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.has("0,0,0")).toBe(false);
      expect(useBlockStore.getState().blocks.has("1,0,0")).toBe(true);
    });

    it("refuses a cube with 2+ pipes and sets a warning", () => {
      const incoming = new Map<string, Block>([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
        ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OZX" }],
        ["0,1,0", { pos: { x: 0, y: 1, z: 0 }, type: "ZOX" }],
      ]);
      useBlockStore.getState().loadBlocks(incoming);
      useBlockStore.getState().convertBlockToPort({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(3);
      expect(useBlockStore.getState().portWarning).toMatch(/2 pipes attached/);
    });

    it("refuses a pipe and sets a warning", () => {
      useBlockStore.setState({ pipeVariant: "ZX" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.getState().convertBlockToPort({ x: 1, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(1);
      expect(useBlockStore.getState().portWarning).toMatch(/Only cubes/);
    });

    it("is a no-op on an empty position", () => {
      useBlockStore.getState().convertBlockToPort({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().portWarning).toBeNull();
    });

    it("can be undone to restore the cube", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().convertBlockToPort({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.has("0,0,0")).toBe(true);
    });
  });

  describe("setPlacePort", () => {
    it("clears pipeVariant when turned on", () => {
      useBlockStore.setState({ pipeVariant: "ZX" });
      useBlockStore.getState().setPlacePort(true);
      expect(useBlockStore.getState().placePort).toBe(true);
      expect(useBlockStore.getState().pipeVariant).toBeNull();
    });

    it("is cleared by setCubeType", () => {
      useBlockStore.getState().setPlacePort(true);
      useBlockStore.getState().setCubeType("ZXZ");
      expect(useBlockStore.getState().placePort).toBe(false);
    });

    it("is cleared by setPipeVariant", () => {
      useBlockStore.getState().setPlacePort(true);
      useBlockStore.getState().setPipeVariant("ZX");
      expect(useBlockStore.getState().placePort).toBe(false);
    });

    it("is cleared when leaving place mode", () => {
      useBlockStore.getState().setPlacePort(true);
      useBlockStore.getState().setMode("delete");
      expect(useBlockStore.getState().placePort).toBe(false);
    });
  });

  describe("setMode clears selection", () => {
    it("clears selection when switching to place mode", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ mode: "select" });
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      useBlockStore.getState().setMode("place");
      expect(useBlockStore.getState().selectedKeys.size).toBe(0);
    });

    it("clears selection when switching to delete mode", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ mode: "select" });
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      useBlockStore.getState().setMode("delete");
      expect(useBlockStore.getState().selectedKeys.size).toBe(0);
    });
  });

  describe("loadBlocks", () => {
    it("replaces all blocks with incoming blocks", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const incoming = new Map([["3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "ZXZ" as const }]]);
      useBlockStore.getState().loadBlocks(incoming);
      expect(useBlockStore.getState().blocks.size).toBe(1);
      expect(useBlockStore.getState().blocks.get("3,0,0")?.type).toBe("ZXZ");
      expect(useBlockStore.getState().blocks.has("0,0,0")).toBe(false);
    });

    it("can be undone to restore previous state", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const incoming = new Map([["3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "ZXZ" as const }]]);
      useBlockStore.getState().loadBlocks(incoming);
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.size).toBe(1);
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XZZ");
    });

    it("can be redone to restore imported state", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const incoming = new Map([["3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "ZXZ" as const }]]);
      useBlockStore.getState().loadBlocks(incoming);
      useBlockStore.getState().undo();
      useBlockStore.getState().redo();
      expect(useBlockStore.getState().blocks.size).toBe(1);
      expect(useBlockStore.getState().blocks.get("3,0,0")?.type).toBe("ZXZ");
    });

    it("is a no-op when both empty", () => {
      const histBefore = useBlockStore.getState().history.length;
      useBlockStore.getState().loadBlocks(new Map());
      expect(useBlockStore.getState().history.length).toBe(histBefore);
    });
  });
});
