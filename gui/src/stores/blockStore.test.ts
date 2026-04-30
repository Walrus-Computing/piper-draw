import { describe, expect, it, beforeEach } from "vitest";
import { useBlockStore } from "./blockStore";
import type { Block } from "../types";
import { buildSpatialIndex } from "../types";

function reset() {
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

    it("removes a user-placed port marker left orphaned by deleting its only pipe", () => {
      useBlockStore.getState().addPortAt({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "ZX" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      expect(useBlockStore.getState().portPositions.has("0,0,0")).toBe(true);
      useBlockStore.setState({ selectedKeys: new Set(["1,0,0"]) });
      useBlockStore.getState().deleteSelected();
      expect(useBlockStore.getState().blocks.size).toBe(0);
      expect(useBlockStore.getState().portPositions.has("0,0,0")).toBe(false);
    });

    it("keeps a user-placed port marker if a cube still occupies its slot", () => {
      // Two colinear pipes share endpoint 0,0,0 → auto-promoted to a cube there.
      const incoming = new Map<string, Block>([
        ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OZX" }],
        ["-2,0,0", { pos: { x: -2, y: 0, z: 0 }, type: "OZX" }],
      ]);
      useBlockStore.getState().loadBlocks(incoming);
      // Record explicit port intent at the cube slot (user placed it there earlier).
      useBlockStore.setState({ portPositions: new Set(["0,0,0"]) });
      // Deleting one pipe leaves the cube (cubes don't auto-demote) — marker survives.
      useBlockStore.setState({ selectedKeys: new Set(["1,0,0"]) });
      useBlockStore.getState().deleteSelected();
      expect(useBlockStore.getState().portPositions.has("0,0,0")).toBe(true);
    });

    it("undo of port-orphan cleanup restores both pipe and marker", () => {
      useBlockStore.getState().addPortAt({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "ZX" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.setState({ selectedKeys: new Set(["1,0,0"]) });
      useBlockStore.getState().deleteSelected();
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.has("1,0,0")).toBe(true);
      expect(useBlockStore.getState().portPositions.has("0,0,0")).toBe(true);
    });
  });

  describe("removeBlock port cleanup", () => {
    it("removes a user-placed port marker left orphaned when its pipe is removed", () => {
      useBlockStore.getState().addPortAt({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "ZX" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.getState().removeBlock({ x: 1, y: 0, z: 0 });
      expect(useBlockStore.getState().portPositions.has("0,0,0")).toBe(false);
    });

    it("undo restores the user-placed port marker cleaned up by pipe removal", () => {
      useBlockStore.getState().addPortAt({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "ZX" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.getState().removeBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.has("1,0,0")).toBe(true);
      expect(useBlockStore.getState().portPositions.has("0,0,0")).toBe(true);
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
    it("arms the port tool when turned on", () => {
      useBlockStore.getState().setPlacePort(true);
      expect(useBlockStore.getState().armedTool).toBe("port");
    });

    it("is superseded by setCubeType", () => {
      useBlockStore.getState().setPlacePort(true);
      useBlockStore.getState().setCubeType("ZXZ");
      expect(useBlockStore.getState().armedTool).toBe("cube");
    });

    it("is superseded by setPipeVariant", () => {
      useBlockStore.getState().setPlacePort(true);
      useBlockStore.getState().setPipeVariant("ZX");
      expect(useBlockStore.getState().armedTool).toBe("pipe");
    });

    it("disarms back to pointer when turned off", () => {
      useBlockStore.getState().setPlacePort(true);
      useBlockStore.getState().setPlacePort(false);
      expect(useBlockStore.getState().armedTool).toBe("pointer");
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

  describe("rotateSelected", () => {
    it("rotates a single cube in place and updates its type (CCW)", () => {
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      const result = useBlockStore.getState().rotateSelected("z", "ccw");
      expect(result).toEqual({ ok: true });
      expect(useBlockStore.getState().blocks.size).toBe(1);
      const b = useBlockStore.getState().blocks.get("0,0,0");
      expect(b?.type).toBe("ZXZ");
    });

    it("rotates a line of cube → pipe → cube together around their bbox center", () => {
      useBlockStore.setState({ cubeType: "ZZX", freeBuild: true });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "ZX" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      const result = useBlockStore.getState().rotateSelected("z", "ccw");
      expect(result).toEqual({ ok: true });
      const blocks = useBlockStore.getState().blocks;
      // bbox center (1.5, 0, 0) → snaps to (3, 0, 0). Rotating CCW around (3,0,0):
      //   (0,0,0) → (3,-3,0); (3,0,0) → (3,0,0); (1,0,0) → (3,-2,0).
      expect(blocks.has("3,-3,0")).toBe(true);
      expect(blocks.has("3,0,0")).toBe(true);
      expect(blocks.has("3,-2,0")).toBe(true);
      // The pipe is now Y-axis at (3,-2,0).
      expect(blocks.get("3,-2,0")?.type).toBe("ZOX");
    });

    it("CCW then CW returns to original state", () => {
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().rotateSelected("z", "ccw");
      useBlockStore.getState().rotateSelected("z", "cw");
      const blocks = useBlockStore.getState().blocks;
      expect(blocks.size).toBe(2);
      expect(blocks.get("0,0,0")?.type).toBe("XZZ");
      expect(blocks.get("3,0,0")?.type).toBe("XZZ");
    });

    it("four CCW rotations is identity (even with off-center bbox, thanks to pivot caching)", () => {
      // Pivot is cached after the first rotation, so subsequent rotations use
      // the same pivot. This means 4×CCW returns to identity even when the
      // initial bbox center is not cube-grid-aligned.
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 3, z: 0 });
      useBlockStore.getState().selectAll();
      for (let i = 0; i < 4; i++) useBlockStore.getState().rotateSelected("z", "ccw");
      const blocks = useBlockStore.getState().blocks;
      expect(blocks.size).toBe(2);
      expect(blocks.get("0,0,0")?.type).toBe("XZZ");
      expect(blocks.get("3,3,0")?.type).toBe("XZZ");
    });

    it("clears cached pivot when selection changes", () => {
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 3, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().rotateSelected("z", "ccw");
      expect(useBlockStore.getState().selectionPivot).not.toBeNull();
      useBlockStore.getState().clearSelection();
      expect(useBlockStore.getState().selectionPivot).toBeNull();
    });

    it("aborts on collision with a non-selected block and leaves state intact", () => {
      useBlockStore.setState({ cubeType: "XZZ" });
      // Selected block rotates from (3,0,0) to (0,3,0) around (0,0,0)…
      // …but we'll put a non-selected block at (0,3,0) to block it.
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 0, y: 3, z: 0 });
      // Select just the first two cubes (selection bbox (0..3, 0, 0), center (1.5,0)
      // → snap (3,0,0); rotating (0,0,0) around (3,0,0) CCW → (3,-3,0).
      // That's empty so no collision. Try a different setup.
      const s = useBlockStore.getState();
      s.selectBlock({ x: 0, y: 0, z: 0 }, false);
      s.selectBlock({ x: 3, y: 0, z: 0 }, true);
      // Manually populate a collision: rotated (3,0,0) around (3,0,0) stays (3,0,0) -> fine.
      // rotated (0,0,0) around (3,0,0) CCW → (3,-3,0). Add a blocker there.
      s.clearSelection();
      s.addBlock({ x: 3, y: -3, z: 0 });
      s.selectBlock({ x: 0, y: 0, z: 0 }, false);
      s.selectBlock({ x: 3, y: 0, z: 0 }, true);
      const blocksBefore = new Map(useBlockStore.getState().blocks);
      const result = useBlockStore.getState().rotateSelected("z", "ccw");
      expect(result.ok).toBe(false);
      // State unchanged
      const blocksAfter = useBlockStore.getState().blocks;
      expect(blocksAfter.size).toBe(blocksBefore.size);
      for (const [k, v] of blocksBefore) expect(blocksAfter.get(k)).toEqual(v);
    });

    it("rotates a Y block and keeps its type", () => {
      useBlockStore.setState({ cubeType: "Y" });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      const result = useBlockStore.getState().rotateSelected("z", "ccw");
      expect(result).toEqual({ ok: true });
      const blocks = useBlockStore.getState().blocks;
      // Single-block selection uses its own pos as pivot → stays in place.
      expect(blocks.get("3,0,0")?.type).toBe("Y");
    });

    it("undo after rotate restores positions and types", () => {
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().rotateSelected("z", "ccw");
      useBlockStore.getState().undo();
      const blocks = useBlockStore.getState().blocks;
      expect(blocks.size).toBe(2);
      expect(blocks.get("0,0,0")?.type).toBe("XZZ");
      expect(blocks.get("3,0,0")?.type).toBe("XZZ");
    });

    it("redo after undo re-applies the rotation", () => {
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().rotateSelected("z", "ccw");
      const afterRotate = new Map(useBlockStore.getState().blocks);
      useBlockStore.getState().undo();
      useBlockStore.getState().redo();
      const blocks = useBlockStore.getState().blocks;
      expect(blocks.size).toBe(afterRotate.size);
      for (const [k, v] of afterRotate) expect(blocks.get(k)).toEqual(v);
    });

    it("pivot override keeps the override block in place", () => {
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      // Use (0,0,0) as override pivot; (3,0,0) should rotate to (0,3,0).
      const result = useBlockStore.getState().rotateSelected("z", "ccw", { x: 0, y: 0, z: 0 });
      expect(result).toEqual({ ok: true });
      const blocks = useBlockStore.getState().blocks;
      expect(blocks.has("0,0,0")).toBe(true);
      expect(blocks.has("0,3,0")).toBe(true);
    });

    it("selection follows rotated blocks", () => {
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().rotateSelected("z", "ccw");
      // Single cube pivots on itself — new key is the same.
      expect(useBlockStore.getState().selectedKeys.has("0,0,0")).toBe(true);
    });

    it("is a no-op when nothing is selected", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const histBefore = useBlockStore.getState().history.length;
      const result = useBlockStore.getState().rotateSelected("z", "ccw");
      expect(result).toEqual({ ok: true });
      expect(useBlockStore.getState().history.length).toBe(histBefore);
    });

    it("aborts when rotating a lone cube would break its adjacent pipe", () => {
      // Cube ZXZ at (0,0,0) with X-axis pipe OXZ (variant XZ) at (1,0,0) is a
      // valid pair. Rotating the cube alone turns it into XZZ, whose Y=Z
      // conflicts with the pipe's Y=X requirement.
      useBlockStore.setState({ cubeType: "ZXZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: null });
      const blocksBefore = new Map(useBlockStore.getState().blocks);

      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      const result = useBlockStore.getState().rotateSelected("z", "ccw");
      expect(result.ok).toBe(false);

      // State unchanged
      const blocksAfter = useBlockStore.getState().blocks;
      expect(blocksAfter.size).toBe(blocksBefore.size);
      for (const [k, v] of blocksBefore) expect(blocksAfter.get(k)).toEqual(v);
    });

    it("allows the illegal-pair rotation when freeBuild is on", () => {
      useBlockStore.setState({ cubeType: "ZXZ", freeBuild: true });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: null });

      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      const result = useBlockStore.getState().rotateSelected("z", "ccw");
      expect(result).toEqual({ ok: true });
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XZZ");
    });

    it("allows rotating a cube + its attached pipe together", () => {
      useBlockStore.setState({ cubeType: "ZXZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: null });

      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      useBlockStore.getState().selectBlock({ x: 1, y: 0, z: 0 }, true);
      const result = useBlockStore.getState().rotateSelected("z", "ccw");
      expect(result).toEqual({ ok: true });
    });

    it("aborts when rotating a lone pipe would break a stationary neighbor cube", () => {
      // Cube ZXZ at (0,0,0) with pipe OXZ at (1,0,0). Rotating just the pipe CCW
      // (pivot snaps to (0,0,0)) moves it to (0,1,0) with type XOZ. The cube at
      // (0,0,0) now needs X=X (mismatch with ZXZ's X=Z).
      useBlockStore.setState({ cubeType: "ZXZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: null });
      const blocksBefore = new Map(useBlockStore.getState().blocks);

      useBlockStore.getState().selectBlock({ x: 1, y: 0, z: 0 }, false);
      const result = useBlockStore.getState().rotateSelected("z", "ccw");
      expect(result.ok).toBe(false);

      const blocksAfter = useBlockStore.getState().blocks;
      expect(blocksAfter.size).toBe(blocksBefore.size);
      for (const [k, v] of blocksBefore) expect(blocksAfter.get(k)).toEqual(v);
    });

    it("rotates a single cube around X axis with type transform", () => {
      useBlockStore.setState({ cubeType: "XZX" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      const result = useBlockStore.getState().rotateSelected("x", "ccw");
      expect(result).toEqual({ ok: true });
      // Single-block selection pivots on itself; type rotates: XZX → XXZ.
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XXZ");
    });

    it("rotates a single cube around Y axis with type transform", () => {
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      const result = useBlockStore.getState().rotateSelected("y", "ccw");
      expect(result).toEqual({ ok: true });
      // XZZ rotated CCW around Y: X → -Z, Z → X → "ZZX".
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("ZZX");
    });

    it("flips a multi-cube selection 180° around X axis (Y/Z negate)", () => {
      useBlockStore.setState({ cubeType: "XZZ", freeBuild: true });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 0, y: 3, z: 0 });
      useBlockStore.getState().selectAll();
      const result = useBlockStore.getState().rotateSelected("x", "flip");
      expect(result).toEqual({ ok: true });
      const blocks = useBlockStore.getState().blocks;
      // bbox center on Y is (0, 1.5, 0) → snaps to (0, 3, 0). Flipping Y around 3:
      // (0,0,0) → (0, 6, 0); (0, 3, 0) → (0, 3, 0).
      expect(blocks.has("0,6,0")).toBe(true);
      expect(blocks.has("0,3,0")).toBe(true);
    });

    it("two flips around any axis is identity", () => {
      useBlockStore.setState({ cubeType: "XZZ", freeBuild: true });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 3, z: 3 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().rotateSelected("x", "flip");
      useBlockStore.getState().rotateSelected("x", "flip");
      const blocks = useBlockStore.getState().blocks;
      expect(blocks.has("0,0,0")).toBe(true);
      expect(blocks.has("3,3,3")).toBe(true);
    });

    it("rejects X rotation of a Y block with a clear error", () => {
      useBlockStore.setState({ cubeType: "Y" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      const result = useBlockStore.getState().rotateSelected("x", "ccw");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/can only rotate around the Z axis/);
    });

    it("allows Z flip of a Y block (Z direction preserved)", () => {
      useBlockStore.setState({ cubeType: "Y" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      const result = useBlockStore.getState().rotateSelected("z", "flip");
      expect(result).toEqual({ ok: true });
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("Y");
    });

    it("rejects rotating a Z-open pipe around X axis when adjacent to a Y block", () => {
      // Setup: Y block at (0,0,0) with a Z-open pipe at (0,0,1).
      useBlockStore.setState({ cubeType: "Y" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "ZX" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 1 });
      useBlockStore.setState({ pipeVariant: null });
      // Select only the pipe and rotate it around X axis. The pipe lands at
      // (0,-2,0) as a Y-axis pipe — and the Y block at (0,0,0) is at one of
      // the pipe's endpoints. Color rules can't catch this (Y blocks are
      // excluded from cube-color validation), so the new Y-neighbor check is
      // the ONLY pass that rejects this rotation. Asserting `result.reason`
      // proves the new code path fires.
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 1 }, false);
      const result = useBlockStore.getState().rotateSelected("x", "ccw");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/Z-open pipes/);
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("Y");
      expect(useBlockStore.getState().blocks.get("0,0,1")).toBeDefined();
    });

    it("four CCW rotations around X axis is identity (multi-block at the store level)", () => {
      useBlockStore.setState({ cubeType: "XZZ", freeBuild: true });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 0, y: 3, z: 0 });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 3 });
      useBlockStore.getState().selectAll();
      for (let i = 0; i < 4; i++) useBlockStore.getState().rotateSelected("x", "ccw");
      const blocks = useBlockStore.getState().blocks;
      expect(blocks.size).toBe(3);
      expect(blocks.has("0,0,0")).toBe(true);
      expect(blocks.has("0,3,0")).toBe(true);
      expect(blocks.has("0,0,3")).toBe(true);
    });

    it("four CCW rotations around Y axis is identity (multi-block at the store level)", () => {
      useBlockStore.setState({ cubeType: "XZZ", freeBuild: true });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 3 });
      useBlockStore.getState().selectAll();
      for (let i = 0; i < 4; i++) useBlockStore.getState().rotateSelected("y", "ccw");
      const blocks = useBlockStore.getState().blocks;
      expect(blocks.size).toBe(3);
      expect(blocks.has("0,0,0")).toBe(true);
      expect(blocks.has("3,0,0")).toBe(true);
      expect(blocks.has("0,0,3")).toBe(true);
    });

    it("recomputes pivot when rotation axis changes", () => {
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 3, z: 3 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().rotateSelected("z", "ccw");
      const pivotAfterZ = useBlockStore.getState().selectionPivot;
      expect(pivotAfterZ?.axis).toBe("z");
      // Switch axis → pivot recomputes (axis updates to "x").
      useBlockStore.getState().rotateSelected("x", "ccw");
      const pivotAfterX = useBlockStore.getState().selectionPivot;
      expect(pivotAfterX?.axis).toBe("x");
    });
  });

  describe("setMode clears selection", () => {
    it("clears selection when switching from edit to build", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      expect(useBlockStore.getState().selectedKeys.size).toBe(1);
      useBlockStore.getState().setMode("build");
      expect(useBlockStore.getState().selectedKeys.size).toBe(0);
    });

    it("clears selection when arming a placement tool from pointer", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectBlock({ x: 0, y: 0, z: 0 }, false);
      expect(useBlockStore.getState().selectedKeys.size).toBe(1);
      useBlockStore.getState().setCubeType("XZZ");
      expect(useBlockStore.getState().selectedKeys.size).toBe(0);
    });
  });

  describe("cyclePipe — just-traversed pipe preference", () => {
    // Scenario: cube ZZX at (3,0,0) with two dangling pipes on different axes.
    // Both pipes have two valid types (OZX/OXZH on X, ZOX/ZOXH on Y) because
    // the far end of each is an open port. Cursor sits on the cube, so R with
    // no preference would bail with "Multiple undetermined pipes".
    function setupLCorner() {
      const blocks = new Map<string, Block>([
        ["3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "ZZX" }],
        ["1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OZX" }],
        ["3,1,0", { pos: { x: 3, y: 1, z: 0 }, type: "ZOX" }],
      ]);
      useBlockStore.setState({
        blocks,
        spatialIndex: buildSpatialIndex(blocks),
        hiddenFaces: new Map(),
        history: [],
        future: [],
        mode: "build",
        freeBuild: false,
        buildCursor: { x: 3, y: 0, z: 0 },
        buildHistory: [],
        undeterminedCubes: new Map(),
        hoveredInvalidReason: null,
      });
    }

    it("bails with 'Multiple undetermined pipes' when buildHistory is empty", () => {
      setupLCorner();
      useBlockStore.getState().cyclePipe();
      const s = useBlockStore.getState();
      expect(s.hoveredInvalidReason).toBe("Multiple undetermined pipes — cannot cycle");
      expect(s.blocks.get("1,0,0")?.type).toBe("OZX");
      expect(s.blocks.get("3,1,0")?.type).toBe("ZOX");
    });

    it("cycles the just-traversed pipe when a build step is on the history stack", () => {
      setupLCorner();
      // Simulate having stepped +X from (0,0,0) to (3,0,0): pipe at (1,0,0).
      useBlockStore.setState({
        buildHistory: [{
          prevCursorPos: { x: 0, y: 0, z: 0 },
          destCursorPos: { x: 3, y: 0, z: 0 },
          pipe: { key: "1,0,0", block: { pos: { x: 1, y: 0, z: 0 }, type: "OZX" } },
          cube: null,
        }],
      });
      useBlockStore.getState().cyclePipe();
      const s = useBlockStore.getState();
      expect(s.hoveredInvalidReason).toBeNull();
      // X pipe cycled; Y pipe untouched.
      expect(s.blocks.get("1,0,0")?.type).not.toBe("OZX");
      expect(s.blocks.get("3,1,0")?.type).toBe("ZOX");
    });

    it("prefers the Y pipe when the last step came down the Y axis", () => {
      setupLCorner();
      // Simulate having stepped -Y from (3,3,0) to (3,0,0): pipe at (3,1,0).
      useBlockStore.setState({
        buildHistory: [{
          prevCursorPos: { x: 3, y: 3, z: 0 },
          destCursorPos: { x: 3, y: 0, z: 0 },
          pipe: { key: "3,1,0", block: { pos: { x: 3, y: 1, z: 0 }, type: "ZOX" } },
          cube: null,
        }],
      });
      useBlockStore.getState().cyclePipe();
      const s = useBlockStore.getState();
      expect(s.hoveredInvalidReason).toBeNull();
      expect(s.blocks.get("3,1,0")?.type).not.toBe("ZOX");
      expect(s.blocks.get("1,0,0")?.type).toBe("OZX");
    });

    it("falls through to the bail when the last step's pipe isn't cycle-eligible", () => {
      setupLCorner();
      // Step's pipe position doesn't match any adjacent pipe — nothing to prefer.
      useBlockStore.setState({
        buildHistory: [{
          prevCursorPos: { x: 3, y: 0, z: 3 },
          destCursorPos: { x: 3, y: 0, z: 0 },
          pipe: null,
          cube: null,
        }],
      });
      useBlockStore.getState().cyclePipe();
      expect(useBlockStore.getState().hoveredInvalidReason).toBe(
        "Multiple undetermined pipes — cannot cycle",
      );
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

  describe("insertBlocks", () => {
    it("offsets incoming blocks past the existing scene on +X and selects them", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const incoming = new Map([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "ZXZ" as const }],
        ["3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "ZXZ" as const }],
      ]);
      useBlockStore.getState().insertBlocks(incoming);
      const s = useBlockStore.getState();
      // Existing block still present, new blocks appear past x=0 with a +3 gap
      // (existingMaxX=0, incomingMinX=0, delta = ceil((0+3-0)/3)*3 = 3)
      expect(s.blocks.has("0,0,0")).toBe(true);
      expect(s.blocks.get("0,0,0")?.type).toBe("XZZ");
      expect(s.blocks.get("3,0,0")?.type).toBe("ZXZ");
      expect(s.blocks.get("6,0,0")?.type).toBe("ZXZ");
      expect(s.selectedKeys.has("3,0,0")).toBe(true);
      expect(s.selectedKeys.has("6,0,0")).toBe(true);
      expect(s.selectedKeys.has("0,0,0")).toBe(false);
    });

    it("loads at parsed positions when the scene is empty", () => {
      const incoming = new Map([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "ZXZ" as const }],
        ["3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "ZXZ" as const }],
      ]);
      useBlockStore.getState().insertBlocks(incoming);
      const s = useBlockStore.getState();
      expect(s.blocks.size).toBe(2);
      expect(s.blocks.get("0,0,0")?.type).toBe("ZXZ");
      expect(s.selectedKeys.has("0,0,0")).toBe(true);
      expect(s.selectedKeys.has("3,0,0")).toBe(true);
    });

    it("switches to edit/pointer so the selection is immediately usable", () => {
      useBlockStore.setState({ mode: "build", armedTool: "cube" });
      const incoming = new Map([["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "ZXZ" as const }]]);
      useBlockStore.getState().insertBlocks(incoming);
      const s = useBlockStore.getState();
      expect(s.mode).toBe("edit");
      expect(s.armedTool).toBe("pointer");
    });

    it("can be undone to restore the pre-insert scene", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const incoming = new Map([["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "ZXZ" as const }]]);
      useBlockStore.getState().insertBlocks(incoming);
      expect(useBlockStore.getState().blocks.size).toBe(2);
      useBlockStore.getState().undo();
      const s = useBlockStore.getState();
      expect(s.blocks.size).toBe(1);
      expect(s.blocks.has("0,0,0")).toBe(true);
      expect(s.blocks.get("0,0,0")?.type).toBe("XZZ");
    });

    it("is a no-op when incoming is empty", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      const histBefore = useBlockStore.getState().history.length;
      useBlockStore.getState().insertBlocks(new Map());
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

  describe("cycleArmedType", () => {
    it("walks the full PLACEABLE_ORDER (Port → cubes → Y → pipes → wrap)", () => {
      const s = useBlockStore.getState();
      // Start at Port
      s.setPlacePort(true);
      expect(useBlockStore.getState().armedTool).toBe("port");

      // Right through all 6 cubes
      const cubes = ["XZZ", "ZXZ", "ZXX", "XXZ", "ZZX", "XZX"];
      for (const ct of cubes) {
        useBlockStore.getState().cycleArmedType(1);
        const st = useBlockStore.getState();
        expect(st.armedTool).toBe("cube");
        expect(st.cubeType).toBe(ct);
      }

      // → Y
      useBlockStore.getState().cycleArmedType(1);
      let st = useBlockStore.getState();
      expect(st.armedTool).toBe("cube");
      expect(st.cubeType).toBe("Y");

      // → 4 pipes
      const pipes = ["ZX", "XZ", "ZXH", "XZH"] as const;
      for (const v of pipes) {
        useBlockStore.getState().cycleArmedType(1);
        st = useBlockStore.getState();
        expect(st.armedTool).toBe("pipe");
        expect(st.pipeVariant).toBe(v);
      }

      // → wrap back to Port
      useBlockStore.getState().cycleArmedType(1);
      expect(useBlockStore.getState().armedTool).toBe("port");
    });

    it("ArrowLeft from Port wraps to last pipe (XZH)", () => {
      useBlockStore.getState().setPlacePort(true);
      useBlockStore.getState().cycleArmedType(-1);
      const st = useBlockStore.getState();
      expect(st.armedTool).toBe("pipe");
      expect(st.pipeVariant).toBe("XZH");
    });

    it("from pointer, ArrowRight arms Port and ArrowLeft arms last pipe", () => {
      useBlockStore.getState().setArmedTool("pointer");
      useBlockStore.getState().cycleArmedType(1);
      expect(useBlockStore.getState().armedTool).toBe("port");

      useBlockStore.getState().setArmedTool("pointer");
      useBlockStore.getState().cycleArmedType(-1);
      const st = useBlockStore.getState();
      expect(st.armedTool).toBe("pipe");
      expect(st.pipeVariant).toBe("XZH");
    });

    it("does nothing in Keyboard Build mode", () => {
      useBlockStore.setState({ mode: "build", armedTool: "cube", cubeType: "XZZ", pipeVariant: null });
      useBlockStore.getState().cycleArmedType(1);
      const st = useBlockStore.getState();
      expect(st.armedTool).toBe("cube");
      expect(st.cubeType).toBe("XZZ");
    });
  });

  describe("cycleSelectedType — freeBuild bypasses validation", () => {
    it("free-build pipe cycle accepts a variant that color rules would reject", () => {
      // XZZ–XZ–XZZ on the z-axis is a valid pair. A Hadamard variant (XZH → XZOH)
      // flips the +z end's closed-axis basis, so it conflicts with two XZZ cubes.
      useBlockStore.setState({ cubeType: "XZZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 3 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 1 });
      expect(useBlockStore.getState().blocks.get("0,0,1")?.type).toBe("XZO");

      useBlockStore.setState({
        armedTool: "pointer",
        selectedKeys: new Set(["0,0,1"]),
        freeBuild: false,
      });
      useBlockStore.getState().cycleSelectedType(1, { kind: "pipe", variant: "XZH" });
      expect(useBlockStore.getState().blocks.get("0,0,1")?.type).toBe("XZO");

      useBlockStore.setState({ freeBuild: true });
      useBlockStore.getState().cycleSelectedType(1, { kind: "pipe", variant: "XZH" });
      expect(useBlockStore.getState().blocks.get("0,0,1")?.type).toBe("XZOH");
    });

    it("free-build cube cycle accepts a CUBE_TYPE that color rules would reject", () => {
      // OXZ pipe at (1,0,0) constrains the cube at (0,0,0) to Y=X, Z=Z (only
      // ZXZ and XXZ pass). XZX has Y=Z and is rejected without freeBuild.
      useBlockStore.setState({ cubeType: "ZXZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("ZXZ");

      useBlockStore.setState({
        armedTool: "pointer",
        selectedKeys: new Set(["0,0,0"]),
        freeBuild: false,
      });
      useBlockStore.getState().cycleSelectedType(1, { kind: "cube", type: "XZX" });
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("ZXZ");

      useBlockStore.setState({ freeBuild: true });
      useBlockStore.getState().cycleSelectedType(1, { kind: "cube", type: "XZX" });
      expect(useBlockStore.getState().blocks.get("0,0,0")?.type).toBe("XZX");
    });

    it("free-build cube cycle includes the port option even with two attached pipes", () => {
      // ZXZ–XZ–ZXZ–XZ–ZXZ along x. The middle cube at (3,0,0) has two attached
      // X-pipes, so portAllowed = (pipeCount < 2) = false without freeBuild.
      useBlockStore.setState({ cubeType: "ZXZ" });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 6, y: 0, z: 0 });
      useBlockStore.setState({ pipeVariant: "XZ" });
      useBlockStore.getState().addBlock({ x: 1, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 4, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(5);

      useBlockStore.setState({
        armedTool: "pointer",
        selectedKeys: new Set(["3,0,0"]),
        freeBuild: false,
      });
      useBlockStore.getState().cycleSelectedType(1, { kind: "port" });
      expect(useBlockStore.getState().blocks.has("3,0,0")).toBe(true);
      expect(useBlockStore.getState().portPositions.has("3,0,0")).toBe(false);

      useBlockStore.setState({ freeBuild: true });
      useBlockStore.getState().cycleSelectedType(1, { kind: "port" });
      const s = useBlockStore.getState();
      expect(s.blocks.has("3,0,0")).toBe(false);
      expect(s.portPositions.has("3,0,0")).toBe(true);
      expect(s.selectedKeys.has("3,0,0")).toBe(false);
      expect(s.selectedPortPositions.has("3,0,0")).toBe(true);
    });
  });

  describe("buildMove from an empty origin", () => {
    it("leaves the origin slot empty (no cube placed at the start position)", () => {
      useBlockStore.setState({
        mode: "build",
        buildCursor: { x: 0, y: 0, z: 0 },
        buildHistory: [],
      });
      const ok = useBlockStore.getState().buildMove({ tqecAxis: 0, sign: 1 });
      expect(ok).toBe(true);
      const s = useBlockStore.getState();
      // Pipe placed between origin and dest; neither endpoint holds a cube.
      expect(s.blocks.has("1,0,0")).toBe(true);
      expect(s.blocks.has("0,0,0")).toBe(false);
      expect(s.blocks.has("3,0,0")).toBe(false);
      // Cursor advances to the destination slot.
      expect(s.buildCursor).toEqual({ x: 3, y: 0, z: 0 });
    });

    it("promotes the origin port to a cube once a second pipe attaches", () => {
      useBlockStore.setState({
        mode: "build",
        buildCursor: { x: 0, y: 0, z: 0 },
        buildHistory: [],
      });
      // First step: +X. Origin stays a port.
      useBlockStore.getState().buildMove({ tqecAxis: 0, sign: 1 });
      expect(useBlockStore.getState().blocks.has("0,0,0")).toBe(false);

      // Move cursor back to the origin port and build along +Y — now the
      // origin has two attached pipes and should auto-promote to a cube.
      useBlockStore.setState({ buildCursor: { x: 0, y: 0, z: 0 } });
      useBlockStore.getState().buildMove({ tqecAxis: 1, sign: 1 });
      const origin = useBlockStore.getState().blocks.get("0,0,0");
      expect(origin).toBeDefined();
      expect(origin!.type).not.toMatch(/O/); // cube, not pipe
    });
  });

  describe("ensurePortLabels — default io from pipe geometry", () => {
    function seed(blocks: Array<{ x: number; y: number; z: number; type: Block["type"] }>) {
      const map = new Map<string, Block>();
      for (const b of blocks) {
        map.set(`${b.x},${b.y},${b.z}`, { pos: { x: b.x, y: b.y, z: b.z }, type: b.type });
      }
      useBlockStore.setState({ blocks: map, portMeta: new Map() });
    }

    it("Z-axis pipe: -z port defaults to 'in', +z port defaults to 'out'", () => {
      seed([{ x: 0, y: 0, z: 1, type: "ZXO" }]);
      useBlockStore.getState().ensurePortLabels();
      const meta = useBlockStore.getState().portMeta;
      expect(meta.get("0,0,0")?.io).toBe("in");
      expect(meta.get("0,0,3")?.io).toBe("out");
    });

    it("X-axis pipe: both ports default to 'in'", () => {
      seed([{ x: 1, y: 0, z: 0, type: "OXZ" }]);
      useBlockStore.getState().ensurePortLabels();
      const meta = useBlockStore.getState().portMeta;
      expect(meta.get("0,0,0")?.io).toBe("in");
      expect(meta.get("3,0,0")?.io).toBe("in");
    });

    it("manual setPortIO override survives a subsequent ensurePortLabels", () => {
      seed([{ x: 0, y: 0, z: 1, type: "ZXO" }]);
      useBlockStore.getState().ensurePortLabels();
      // Flip the +z port from its default 'out' to 'in'.
      useBlockStore.getState().setPortIO({ x: 0, y: 0, z: 3 }, "in");
      useBlockStore.getState().ensurePortLabels();
      expect(useBlockStore.getState().portMeta.get("0,0,3")?.io).toBe("in");
    });
  });

  describe("reorderPort", () => {
    function seedFourPorts() {
      useBlockStore.setState({
        blocks: new Map(),
        portPositions: new Set(["0,0,0", "3,0,0", "6,0,0", "9,0,0"]),
        portMeta: new Map(),
      });
      useBlockStore.getState().ensurePortLabels();
    }

    function ranksByX(): Record<number, number | undefined> {
      const out: Record<number, number | undefined> = {};
      for (const [k, m] of useBlockStore.getState().portMeta) {
        const x = Number(k.split(",")[0]);
        out[x] = m.rank;
      }
      return out;
    }

    it("ensurePortLabels assigns sequential ranks 0..N-1 in spatial order", () => {
      seedFourPorts();
      // Spatial sort is by x ascending → ranks should match the x order.
      expect(ranksByX()).toEqual({ 0: 0, 3: 1, 6: 2, 9: 3 });
    });

    it("moves a port forward and rewrites all ranks to 0..N-1", () => {
      seedFourPorts();
      // Move the port at index 3 (x=9) to index 0.
      useBlockStore.getState().reorderPort(3, 0);
      expect(ranksByX()).toEqual({ 9: 0, 0: 1, 3: 2, 6: 3 });
    });

    it("moves a port backward and rewrites all ranks", () => {
      seedFourPorts();
      // Move the port at index 0 (x=0) to index 2.
      useBlockStore.getState().reorderPort(0, 2);
      expect(ranksByX()).toEqual({ 3: 0, 6: 1, 0: 2, 9: 3 });
    });

    it("is a no-op when from === to", () => {
      seedFourPorts();
      const before = useBlockStore.getState().portMeta;
      useBlockStore.getState().reorderPort(2, 2);
      // Object identity preserved (set returned `state` unchanged).
      expect(useBlockStore.getState().portMeta).toBe(before);
    });

    it("is a no-op when indices are out of range", () => {
      seedFourPorts();
      const before = useBlockStore.getState().portMeta;
      useBlockStore.getState().reorderPort(-1, 2);
      useBlockStore.getState().reorderPort(0, 99);
      expect(useBlockStore.getState().portMeta).toBe(before);
    });
  });

  describe("copy / paste", () => {
    it("copySelection snapshots selected blocks normalized to origin", () => {
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 6, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().copySelection();
      const clip = useBlockStore.getState().clipboard!;
      expect(clip.size).toBe(2);
      // Min corner translated to origin.
      expect(clip.has("0,0,0")).toBe(true);
      expect(clip.has("3,0,0")).toBe(true);
    });

    it("pasteClipboard arms paste mode and clears selection without mutating blocks", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().copySelection();
      const blocksBefore = useBlockStore.getState().blocks.size;
      useBlockStore.setState({ hoveredGridPos: { x: 9, y: 0, z: 0 } });
      useBlockStore.getState().pasteClipboard();
      const s = useBlockStore.getState();
      expect(s.armedTool).toBe("paste");
      expect(s.mode).toBe("edit");
      expect(s.blocks.size).toBe(blocksBefore); // no commit yet
      expect(s.selectedKeys.size).toBe(0); // selection cleared on arm
    });

    it("commitPaste at a hovered cell merges translated clipboard entries", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().copySelection();
      useBlockStore.getState().clearAll();

      useBlockStore.getState().pasteClipboard(); // arm
      useBlockStore.setState({ hoveredGridPos: { x: 9, y: 0, z: 0 } });
      useBlockStore.getState().commitPaste();
      const s = useBlockStore.getState();
      expect(s.blocks.has("9,0,0")).toBe(true);
      expect(s.blocks.has("12,0,0")).toBe(true);
      expect(s.selectedKeys.has("9,0,0")).toBe(true);
      expect(s.selectedKeys.has("12,0,0")).toBe(true);
      expect(s.mode).toBe("edit");
      expect(s.armedTool).toBe("pointer");
    });

    it("double pasteClipboard (arm then commit) pastes at the hovered cell", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().copySelection();
      useBlockStore.getState().clearAll();

      useBlockStore.getState().pasteClipboard(); // arm
      useBlockStore.setState({ hoveredGridPos: { x: 9, y: 0, z: 0 } });
      useBlockStore.getState().pasteClipboard(); // commits while armed
      const s = useBlockStore.getState();
      expect(s.blocks.has("9,0,0")).toBe(true);
      expect(s.armedTool).toBe("pointer");
    });

    it("commitPaste with no hover falls back to the +X auto-offset", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().copySelection();
      useBlockStore.getState().pasteClipboard(); // arm
      useBlockStore.setState({ hoveredGridPos: null });
      useBlockStore.getState().commitPaste();
      const s = useBlockStore.getState();
      expect(s.blocks.has("0,0,0")).toBe(true); // original
      expect(s.blocks.has("3,0,0")).toBe(true); // pasted past the right edge
    });

    it("commitPaste snaps fractional hover to the cube-slot grid (period 3)", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().copySelection();
      useBlockStore.getState().clearAll();
      useBlockStore.getState().pasteClipboard(); // arm
      // Hover at (5,0,0) snaps to (3,0,0).
      useBlockStore.setState({ hoveredGridPos: { x: 5, y: 0, z: 0 } });
      useBlockStore.getState().commitPaste();
      const s = useBlockStore.getState();
      expect(s.blocks.has("3,0,0")).toBe(true);
      expect(s.blocks.has("5,0,0")).toBe(false);
    });

    it("copySelection with empty selection is a no-op and preserves prior clipboard", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().copySelection();
      const first = useBlockStore.getState().clipboard;
      useBlockStore.getState().clearSelection();
      useBlockStore.getState().copySelection();
      expect(useBlockStore.getState().clipboard).toBe(first);
    });

    it("pasteClipboard with null clipboard does not arm paste mode", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().pasteClipboard();
      expect(useBlockStore.getState().armedTool).toBe("cube");
    });

    it("setArmedTool('pointer') cancels paste mode", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().copySelection();
      useBlockStore.getState().pasteClipboard();
      expect(useBlockStore.getState().armedTool).toBe("paste");
      useBlockStore.getState().setArmedTool("pointer");
      expect(useBlockStore.getState().armedTool).toBe("pointer");
      // Blocks unchanged.
      expect(useBlockStore.getState().blocks.size).toBe(1);
    });

    it("undo removes blocks added by commitPaste", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().copySelection();
      useBlockStore.getState().pasteClipboard();
      useBlockStore.setState({ hoveredGridPos: { x: 9, y: 0, z: 0 } });
      useBlockStore.getState().commitPaste();
      expect(useBlockStore.getState().blocks.has("9,0,0")).toBe(true);
      useBlockStore.getState().undo();
      expect(useBlockStore.getState().blocks.has("9,0,0")).toBe(false);
      // Original block is untouched.
      expect(useBlockStore.getState().blocks.has("0,0,0")).toBe(true);
    });

    it("commitPaste skips entries that collide with existing blocks", () => {
      // Two cubes, copy both.
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 3, y: 0, z: 0 });
      useBlockStore.getState().selectAll();
      useBlockStore.getState().copySelection();
      useBlockStore.getState().pasteClipboard();
      // Paste so the first clipboard entry would land on the existing (0,0,0).
      useBlockStore.setState({ hoveredGridPos: { x: 0, y: 0, z: 0 } });
      useBlockStore.getState().commitPaste();
      const s = useBlockStore.getState();
      expect(s.blocks.size).toBe(2); // (0,0,0) existed, (3,0,0) existed → nothing new.
      // No history entry because no entries were added.
      // (Original two adds + no paste step = 2 history entries.)
      expect(s.history.length).toBe(2);
    });
  });

  describe("loadBlocks atomic ports — undo/redo round-trip", () => {
    beforeEach(() => {
      useBlockStore.setState({ portMeta: new Map(), portPositions: new Set() });
    });

    it("captures port state in the load undo command and restores it on undo", () => {
      // Seed the store with a starting scene that has a port.
      useBlockStore.setState({
        blocks: new Map<string, Block>([
          ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
        ]),
        spatialIndex: buildSpatialIndex(
          new Map<string, Block>([
            ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
          ]),
        ),
        portMeta: new Map([["3,0,0", { label: "P_orig", io: "in", rank: 0 }]]),
        portPositions: new Set(["3,0,0"]),
      });

      // Load a new scene with different blocks AND ports atomically.
      const newBlocks = new Map<string, Block>([
        ["6,0,0", { pos: { x: 6, y: 0, z: 0 }, type: "ZXZ" }],
      ]);
      const newPortMeta = new Map([
        ["9,0,0", { label: "P_new", io: "out" as const, rank: 0 }],
      ]);
      const newPortPositions = new Set(["9,0,0"]);
      useBlockStore.getState().loadBlocks(newBlocks, {
        portMeta: newPortMeta,
        portPositions: newPortPositions,
      });

      // After load: only the new state is visible.
      let s = useBlockStore.getState();
      expect(s.blocks.has("6,0,0")).toBe(true);
      expect(s.blocks.has("0,0,0")).toBe(false);
      expect(s.portMeta.get("9,0,0")?.label).toBe("P_new");
      expect(s.portPositions.has("9,0,0")).toBe(true);

      // Undo: original blocks AND original ports both come back.
      useBlockStore.getState().undo();
      s = useBlockStore.getState();
      expect(s.blocks.has("0,0,0")).toBe(true);
      expect(s.blocks.has("6,0,0")).toBe(false);
      expect(s.portMeta.get("3,0,0")?.label).toBe("P_orig");
      expect(s.portPositions.has("3,0,0")).toBe(true);
      expect(s.portMeta.has("9,0,0")).toBe(false);

      // Redo: new state — ports included — comes back.
      useBlockStore.getState().redo();
      s = useBlockStore.getState();
      expect(s.blocks.has("6,0,0")).toBe(true);
      expect(s.portMeta.get("9,0,0")?.label).toBe("P_new");
      expect(s.portMeta.has("3,0,0")).toBe(false);
    });

    it("preserves prior portMeta when loadBlocks is called without ports (template-load semantics)", () => {
      useBlockStore.setState({
        portMeta: new Map([["3,0,0", { label: "T", io: "in" }]]),
        portPositions: new Set(["3,0,0"]),
      });
      useBlockStore.getState().loadBlocks(
        new Map<string, Block>([
          ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
        ]),
      );
      const s = useBlockStore.getState();
      // portMeta untouched, portPositions cleared (matches prior behavior).
      expect(s.portMeta.get("3,0,0")?.label).toBe("T");
      expect(s.portPositions.size).toBe(0);
    });
  });

  describe("hydrateBlocks — empty incoming clears derived state", () => {
    it("clears spatialIndex and hiddenFaces when hydrating with an empty Map", () => {
      // Seed with non-empty blocks + derived state.
      const blocks = new Map<string, Block>([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
      ]);
      useBlockStore.setState({
        blocks,
        spatialIndex: buildSpatialIndex(blocks),
        hiddenFaces: new Map([["0,0,0", 0]]),
      });
      // Hydrate with empty — derived state must follow.
      useBlockStore.getState().hydrateBlocks(new Map());
      const s = useBlockStore.getState();
      expect(s.blocks.size).toBe(0);
      expect(s.spatialIndex.size).toBe(0);
      expect(s.hiddenFaces.size).toBe(0);
    });
  });
});
