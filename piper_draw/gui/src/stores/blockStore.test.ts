import { describe, expect, it, beforeEach } from "vitest";
import { useBlockStore } from "./blockStore";

function reset() {
  useBlockStore.setState({
    blocks: new Map(),
    history: [],
    future: [],
    mode: "place",
    cubeType: "XZZ",
    pipeVariant: null,
    hoveredGridPos: null,
    hoveredBlockType: null,
    hoveredInvalid: false,
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

    it("rejects placement that overlaps an existing block", () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      expect(useBlockStore.getState().blocks.size).toBe(1);
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
});
