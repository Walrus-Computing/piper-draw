import { describe, expect, it } from "vitest";
import { exportBlocksToDae } from "./daeExport";
import { parseDaeToBlocks } from "./daeImport";
import type { Block } from "../types";

function makeBlocks(...entries: [string, { x: number; y: number; z: number }, string][]): Map<string, Block> {
  const map = new Map<string, Block>();
  for (const [key, pos, type] of entries) {
    map.set(key, { pos, type: type as Block["type"] });
  }
  return map;
}

describe("exportBlocksToDae", () => {
  it("produces valid XML for an empty map", () => {
    const xml = exportBlocksToDae(new Map());
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("SketchUp");
    expect(xml).toContain("Z_UP");
  });

  it("includes the correct asset metadata", () => {
    const xml = exportBlocksToDae(new Map());
    expect(xml).toContain("TQEC Community");
    expect(xml).toContain("https://github.com/tqec/tqec");
    expect(xml).toContain('name="inch"');
    expect(xml).toContain("0.02539999969303608");
  });

  it("creates library node with lowercase block kind name", () => {
    const blocks = makeBlocks(["0,0,0", { x: 0, y: 0, z: 0 }, "XZZ"]);
    const xml = exportBlocksToDae(blocks);
    expect(xml).toContain('name="xzz"');
  });

  it("generates unique instance nodes for each block", () => {
    const blocks = makeBlocks(
      ["0,0,0", { x: 0, y: 0, z: 0 }, "XZZ"],
      ["3,0,0", { x: 3, y: 0, z: 0 }, "ZXZ"],
    );
    const xml = exportBlocksToDae(blocks);
    expect(xml).toContain('id="ID0"');
    expect(xml).toContain('id="ID1"');
  });

  it("includes correct translation in matrix for block at (3,0,0)", () => {
    const blocks = makeBlocks(["3,0,0", { x: 3, y: 0, z: 0 }, "XZZ"]);
    const xml = exportBlocksToDae(blocks);
    expect(xml).toContain("1 0 0 3 0 1 0 0 0 0 1 0 0 0 0 1");
  });

  it("handles all block types without error", () => {
    const allTypes = [
      "XZZ", "ZXZ", "ZXX", "XXZ", "ZZX", "XZX", "Y",
      "OZX", "OXZ", "OZXH", "OXZH",
      "ZOX", "XOZ", "ZOXH", "XOZH",
      "ZXO", "XZO", "ZXOH", "XZOH",
    ];
    for (const type of allTypes) {
      const blocks = makeBlocks(["0,0,0", { x: 0, y: 0, z: 0 }, type]);
      expect(() => exportBlocksToDae(blocks)).not.toThrow();
    }
  });

  it("adds Y half-cube offset when pipe is above", () => {
    const blocks = makeBlocks(
      ["0,0,0", { x: 0, y: 0, z: 0 }, "Y"],
      ["0,0,1", { x: 0, y: 0, z: 1 }, "ZXO"],
    );
    const xml = exportBlocksToDae(blocks);
    // Y block should have z=0.5 in matrix
    expect(xml).toContain("1 0 0 0 0 1 0 0 0 0 1 0.5 0 0 0 1");
  });

  it("does NOT add Y offset when no pipe above", () => {
    const blocks = makeBlocks(["0,0,0", { x: 0, y: 0, z: 0 }, "Y"]);
    const xml = exportBlocksToDae(blocks);
    expect(xml).toContain("1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1");
  });
});

describe("round-trip: export → import", () => {
  it("preserves a single cube", () => {
    const original = makeBlocks(["0,0,0", { x: 0, y: 0, z: 0 }, "XZZ"]);
    const xml = exportBlocksToDae(original);
    const imported = parseDaeToBlocks(xml);
    expect(imported.size).toBe(1);
    const block = imported.get("0,0,0");
    expect(block).toBeDefined();
    expect(block!.type).toBe("XZZ");
  });

  it("preserves multiple cubes at different positions", () => {
    const original = makeBlocks(
      ["0,0,0", { x: 0, y: 0, z: 0 }, "XZZ"],
      ["3,0,0", { x: 3, y: 0, z: 0 }, "ZXZ"],
      ["0,3,0", { x: 0, y: 3, z: 0 }, "ZXX"],
    );
    const xml = exportBlocksToDae(original);
    const imported = parseDaeToBlocks(xml);
    expect(imported.size).toBe(3);
    expect(imported.get("0,0,0")!.type).toBe("XZZ");
    expect(imported.get("3,0,0")!.type).toBe("ZXZ");
    expect(imported.get("0,3,0")!.type).toBe("ZXX");
  });

  it("preserves pipes", () => {
    const original = makeBlocks(
      ["0,0,0", { x: 0, y: 0, z: 0 }, "XZZ"],
      ["1,0,0", { x: 1, y: 0, z: 0 }, "OZX"],
      ["3,0,0", { x: 3, y: 0, z: 0 }, "ZXZ"],
    );
    const xml = exportBlocksToDae(original);
    const imported = parseDaeToBlocks(xml);
    expect(imported.size).toBe(3);
    expect(imported.get("1,0,0")!.type).toBe("OZX");
  });

  it("preserves Y half-cubes", () => {
    const original = makeBlocks(["0,0,0", { x: 0, y: 0, z: 0 }, "Y"]);
    const xml = exportBlocksToDae(original);
    const imported = parseDaeToBlocks(xml);
    expect(imported.size).toBe(1);
    expect(imported.get("0,0,0")!.type).toBe("Y");
  });

  it("preserves Y half-cube with pipe above (offset round-trip)", () => {
    const original = makeBlocks(
      ["0,0,0", { x: 0, y: 0, z: 0 }, "Y"],
      ["0,0,1", { x: 0, y: 0, z: 1 }, "ZXO"],
    );
    const xml = exportBlocksToDae(original);
    const imported = parseDaeToBlocks(xml);
    expect(imported.size).toBe(2);
    expect(imported.get("0,0,0")!.type).toBe("Y");
    expect(imported.get("0,0,1")!.type).toBe("ZXO");
  });

  it("preserves Hadamard pipes", () => {
    const original = makeBlocks(
      ["0,0,0", { x: 0, y: 0, z: 0 }, "XZZ"],
      ["1,0,0", { x: 1, y: 0, z: 0 }, "OZXH"],
      ["3,0,0", { x: 3, y: 0, z: 0 }, "ZXZ"],
    );
    const xml = exportBlocksToDae(original);
    const imported = parseDaeToBlocks(xml);
    expect(imported.size).toBe(3);
    expect(imported.get("1,0,0")!.type).toBe("OZXH");
  });

  it("strips Y-twist pipes on export (free-build only, no TQEC semantics)", () => {
    const original = makeBlocks(
      ["0,0,0", { x: 0, y: 0, z: 0 }, "XZZ"],
      ["1,0,0", { x: 1, y: 0, z: 0 }, "OZXY"],
      ["3,0,0", { x: 3, y: 0, z: 0 }, "ZXZ"],
    );
    const xml = exportBlocksToDae(original);
    // The Y-twist pipe should not appear in the output XML at all.
    expect(xml).not.toContain("ozxy");
    expect(xml).not.toContain("OZXY");
    const imported = parseDaeToBlocks(xml);
    expect(imported.size).toBe(2);
    expect(imported.get("0,0,0")!.type).toBe("XZZ");
    expect(imported.get("3,0,0")!.type).toBe("ZXZ");
    expect(imported.has("1,0,0")).toBe(false);
  });

  it("preserves all 6 cube types", () => {
    const types = ["XZZ", "ZXZ", "ZXX", "XXZ", "ZZX", "XZX"] as const;
    const entries: [string, { x: number; y: number; z: number }, string][] = types.map((t, i) => [
      `${i * 3},0,0`,
      { x: i * 3, y: 0, z: 0 },
      t,
    ]);
    const original = makeBlocks(...entries);
    const xml = exportBlocksToDae(original);
    const imported = parseDaeToBlocks(xml);
    expect(imported.size).toBe(6);
    for (const [key, , type] of entries) {
      expect(imported.get(key)!.type).toBe(type);
    }
  });

  it("logs info when faceCorrSurface marks are dropped on export", () => {
    const blocks = new Map<string, Block>([
      [
        "0,0,0",
        {
          pos: { x: 0, y: 0, z: 0 },
          type: "XZZ",
          faceCorrSurface: { "0": "X" },
        },
      ],
    ]);
    const messages: string[] = [];
    const origInfo = console.info;
    console.info = (msg: string) => {
      messages.push(msg);
    };
    try {
      exportBlocksToDae(blocks);
    } finally {
      console.info = origInfo;
    }
    expect(messages.some((m) => m.includes("manual correlation-surface marks"))).toBe(true);
  });

  it("does not include faceCorrSurface data anywhere in the exported XML", () => {
    const blocks = new Map<string, Block>([
      [
        "0,0,0",
        {
          pos: { x: 0, y: 0, z: 0 },
          type: "XZZ",
          faceCorrSurface: { "0": "X", "5": "Z" },
        },
      ],
    ]);
    const xml = exportBlocksToDae(blocks);
    expect(xml).not.toContain("faceCorrSurface");
    // Sanity: the cube itself still exports
    expect(xml).toContain('name="xzz"');
  });
});
