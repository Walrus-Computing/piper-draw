import { describe, expect, it, beforeEach } from "vitest";
import { useBlockStore } from "./blockStore";

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
    hoveredGridPos: null,
    hoveredBlockType: null,
    hoveredInvalid: false,
    selectedKeys: new Set(),
    undeterminedCubes: new Map(),
    freeBuild: false,
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
  });

  describe("flipSelected", () => {
    it("swaps X↔Z on a selected cube", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().flipSelected();
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("ZXX");
    });

    it("flips a connected cube+pipe+cube chain", () => {
      // XZZ cubes with a Z-open pipe between them (variant XZ at Z-axis = XZO)
      // matches the cubes' X=X, Y=Z on the closed axes.
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 1 });
      useBlockStore.setState({ pipeVariant: null, cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 3 });
      expect(useBlockStore.getState().blocks.size).toBe(3);
      useBlockStore.getState().selectAll();
      useBlockStore.getState().flipSelected();
      const b = useBlockStore.getState().blocks;
      expect(b.get("0,0,0")?.type).toBe("ZXX");
      expect(b.get("0,0,1")?.type).toBe("ZXO");
      expect(b.get("0,0,3")?.type).toBe("ZXX");
    });

    it("leaves Y blocks unchanged", () => {
      useBlockStore.setState({ cubeType: "Y" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().flipSelected();
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("Y");
    });

    it("is a no-op when nothing is selected", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const histBefore = useBlockStore.getState().history.length;
      useBlockStore.getState().flipSelected();
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XZZ");
      expect(useBlockStore.getState().history.length).toBe(histBefore);
    });

    it("rejects when flipping would conflict with a non-selected adjacent pipe", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 1 });
      expect(useBlockStore.getState().blocks.size).toBe(2);
      // Select only the cube — flipping it would mismatch the adjacent pipe.
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      useBlockStore.getState().flipSelected();
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XZZ");
      expect(useBlockStore.getState().blocks.get("0,0,1")?.type).toBe("XZO");
    });

    it("allows flipping across a selection boundary when freeBuild is on", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 1 });
      useBlockStore.setState({ freeBuild: true });
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      useBlockStore.getState().flipSelected();
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("ZXX");
    });

    it("can be undone and redone", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().flipSelected();
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XZZ");
      useBlockStore.getState().redo();
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("ZXX");
    });

    it("is idempotent under double flip", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().flipSelected();
      useBlockStore.getState().flipSelected();
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XZZ");
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

  describe("moveSelection", () => {
    function selectAllCurrent() {
      const s = useBlockStore.getState();
      useBlockStore.setState({ selectedKeys: new Set(s.blocks.keys()) });
    }

    it("moves a single selected cube by (3,0,0) and updates selectedKeys", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      selectAllCurrent();
      const ok = useBlockStore.getState().moveSelection({ x: 3, y: 0, z: 0 });
      const s = useBlockStore.getState();
      expect(ok).toBe(true);
      expect(s.blocks.has("0,0,0")).toBe(false);
      expect(s.blocks.get("3,0,0")?.type).toBe("XZZ");
      expect(s.selectedKeys.has("3,0,0")).toBe(true);
      expect(s.selectedKeys.has("0,0,0")).toBe(false);
    });

    it("moves a cube + attached pipe pair together preserving adjacency", () => {
      // ZXZ cubes (Y=X, Z=Z) connected by an OXZ pipe (closed Y=X, Z=Z).
      useBlockStore.setState({ cubeType: "ZXZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: null, cubeType: "XZZ" });
      selectAllCurrent();
      const ok = useBlockStore.getState().moveSelection({ x: 0, y: 3, z: 0 });
      const s = useBlockStore.getState();
      expect(ok).toBe(true);
      expect(s.blocks.size).toBe(3);
      expect(s.blocks.has("0,3,0")).toBe(true);
      expect(s.blocks.has("3,3,0")).toBe(true);
      expect(s.blocks.has("1,3,0")).toBe(true);
      expect(s.blocks.get("1,3,0")?.type).toBe("OXZ");
    });

    it("rejects a move that overlaps a non-selected block", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      // Select only the first cube
      useBlockStore.setState({ selectedKeys: new Set(["0,0,0"]) });
      const ok = useBlockStore.getState().moveSelection({ x: 3, y: 0, z: 0 });
      const s = useBlockStore.getState();
      expect(ok).toBe(false);
      // Both cubes should still be present at their original positions
      expect(s.blocks.has("0,0,0")).toBe(true);
      expect(s.blocks.has("3,0,0")).toBe(true);
      // selectedKeys unchanged
      expect(s.selectedKeys.has("0,0,0")).toBe(true);
    });

    it("rejects a move that creates a color conflict, and succeeds under freeBuild", () => {
      // Cube ZXZ (Y=X,Z=Z) at (0,0,0) with pipe OXZ (Y=X,Z=Z) at (1,0,0) — a valid pair.
      // Cube XZZ (Y=Z,Z=Z) at (6,0,0). Moving the pipe to (4,0,0) puts it next to XZZ,
      // which mismatches on the Y axis → color conflict.
      useBlockStore.setState({ cubeType: "ZXZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: null, cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 6, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(3);

      useBlockStore.setState({ selectedKeys: new Set(["1,0,0"]) });
      const ok = useBlockStore.getState().moveSelection({ x: 3, y: 0, z: 0 });
      expect(ok).toBe(false);

      useBlockStore.setState({ freeBuild: true });
      const ok2 = useBlockStore.getState().moveSelection({ x: 3, y: 0, z: 0 });
      expect(ok2).toBe(true);
      useBlockStore.setState({ freeBuild: false });
    });

    it("delta = {0,0,0} is a no-op with no history entry", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      selectAllCurrent();
      const beforeHist = useBlockStore.getState().history.length;
      const ok = useBlockStore.getState().moveSelection({ x: 0, y: 0, z: 0 });
      expect(ok).toBe(false);
      expect(useBlockStore.getState().history.length).toBe(beforeHist);
    });

    it("undo restores old positions and selection; redo re-applies the move", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.setState({ selectedKeys: new Set(["0,0,0", "3,0,0"]) });
      const ok = useBlockStore.getState().moveSelection({ x: 0, y: 3, z: 0 });
      expect(ok).toBe(true);
      expect(useBlockStore.getState().selectedKeys.has("0,3,0")).toBe(true);

      useBlockStore.getState().undo();
      const s1 = useBlockStore.getState();
      expect(s1.blocks.has("0,0,0")).toBe(true);
      expect(s1.blocks.has("3,0,0")).toBe(true);
      expect(s1.blocks.has("0,3,0")).toBe(false);
      expect(s1.selectedKeys.has("0,0,0")).toBe(true);
      expect(s1.selectedKeys.has("3,0,0")).toBe(true);

      useBlockStore.getState().redo();
      const s2 = useBlockStore.getState();
      expect(s2.blocks.has("0,3,0")).toBe(true);
      expect(s2.blocks.has("3,3,0")).toBe(true);
      expect(s2.blocks.has("0,0,0")).toBe(false);
      expect(s2.selectedKeys.has("0,3,0")).toBe(true);
    });

    it("supports vertical moves (non-zero z) while preserving parity", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ selectedKeys: new Set(["0,0,0"]) });
      const ok = useBlockStore.getState().moveSelection({ x: 0, y: 0, z: 3 });
      expect(ok).toBe(true);
      expect(useBlockStore.getState().blocks.has("0,0,3")).toBe(true);
      expect(useBlockStore.getState().selectedKeys.has("0,0,3")).toBe(true);
    });
  });
});
