import { describe, expect, it } from "vitest";
import type { Block, BlockType, PipeType } from "../types";
import { filterFreeBuildPipes } from "./zx";

function makeBlocks(entries: Array<{ x: number; y: number; z: number; type: BlockType }>) {
  const m = new Map<string, Block>();
  for (const e of entries) {
    m.set(`${e.x},${e.y},${e.z}`, { pos: { x: e.x, y: e.y, z: e.z }, type: e.type });
  }
  return m;
}

describe("filterFreeBuildPipes", () => {
  it("keeps a fully color-consistent cube–pipe–cube line intact", () => {
    // OXZ pipe (axis 1='X', axis 2='Z'); ZXZ cubes both ends agree.
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "ZXZ" as BlockType },
      { x: 1, y: 0, z: 0, type: "OXZ" as BlockType },
      { x: 3, y: 0, z: 0, type: "ZXZ" as BlockType },
    ]);
    const { kept, excluded } = filterFreeBuildPipes(blocks);
    expect(excluded).toBe(0);
    expect(kept).toHaveLength(3);
  });

  it("drops a pipe whose colors disagree with adjacent cubes", () => {
    // OZX pipe needs axis 1='Z', axis 2='X'; cube XZZ has axis 2='Z' → mismatch.
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "XZZ" as BlockType },
      { x: 1, y: 0, z: 0, type: "OZX" as PipeType as BlockType },
    ]);
    const { kept, excluded } = filterFreeBuildPipes(blocks);
    expect(excluded).toBe(1);
    expect(kept.map((b) => b.type)).toEqual(["XZZ"]);
  });

  it("only drops the mismatched pipe, keeps a valid sibling pipe", () => {
    // Valid cube/pipe along +X and a separate mismatched pipe attached to a
    // different cube along +Y.
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "ZXZ" as BlockType },
      { x: 1, y: 0, z: 0, type: "OXZ" as BlockType }, // valid
      { x: 3, y: 0, z: 0, type: "ZXZ" as BlockType },
      { x: 9, y: 0, z: 0, type: "XZZ" as BlockType },
      { x: 9, y: 1, z: 0, type: "ZOX" as PipeType as BlockType }, // mismatch
    ]);
    const { kept, excluded } = filterFreeBuildPipes(blocks);
    expect(excluded).toBe(1);
    expect(kept).toHaveLength(4);
    expect(kept.find((b) => b.pos.x === 9 && b.pos.y === 1)).toBeUndefined();
  });

  it("never excludes cubes", () => {
    const blocks = makeBlocks([
      { x: 0, y: 0, z: 0, type: "XZZ" as BlockType },
      { x: 3, y: 0, z: 0, type: "ZXZ" as BlockType },
    ]);
    const { kept, excluded } = filterFreeBuildPipes(blocks);
    expect(excluded).toBe(0);
    expect(kept).toHaveLength(2);
  });
});
