import { describe, it, expect } from "vitest";
import type { Block } from "../types";
import { posKey } from "../types";
import {
  groupOf,
  groupMembers,
  allGroupIds,
  filterByGroup,
  groupColor,
  paletteIndexFor,
  newGroupId,
  selectionGroupClassification,
  isTqecEligibleBlock,
  OKABE_ITO_PALETTE,
} from "./groupSelectors";

function blk(x: number, y: number, z: number, gid?: string): Block {
  const b: Block = { pos: { x, y, z }, type: "XZZ" };
  if (gid !== undefined) b.groupId = gid;
  return b;
}

function blocksFrom(entries: Block[]): Map<string, Block> {
  const m = new Map<string, Block>();
  for (const b of entries) m.set(posKey(b.pos), b);
  return m;
}

describe("groupSelectors", () => {
  describe("groupOf", () => {
    it("returns groupId when block is grouped", () => {
      const b = blocksFrom([blk(0, 0, 0, "abc12345")]);
      expect(groupOf(b, "0,0,0")).toBe("abc12345");
    });
    it("returns undefined when block is ungrouped", () => {
      const b = blocksFrom([blk(0, 0, 0)]);
      expect(groupOf(b, "0,0,0")).toBeUndefined();
    });
    it("returns undefined when key absent", () => {
      const b = blocksFrom([blk(0, 0, 0)]);
      expect(groupOf(b, "3,0,0")).toBeUndefined();
    });
  });

  describe("groupMembers", () => {
    it("returns all keys with matching groupId", () => {
      const b = blocksFrom([
        blk(0, 0, 0, "g1"),
        blk(3, 0, 0, "g1"),
        blk(0, 3, 0, "g2"),
        blk(0, 0, 3),
      ]);
      const m = groupMembers(b, "g1").sort();
      expect(m).toEqual(["0,0,0", "3,0,0"]);
    });
    it("returns empty array for missing group", () => {
      const b = blocksFrom([blk(0, 0, 0)]);
      expect(groupMembers(b, "nope")).toEqual([]);
    });
  });

  describe("allGroupIds", () => {
    it("returns distinct groupIds across blocks", () => {
      const b = blocksFrom([
        blk(0, 0, 0, "g1"),
        blk(3, 0, 0, "g1"),
        blk(0, 3, 0, "g2"),
        blk(0, 0, 3),
      ]);
      expect([...allGroupIds(b)].sort()).toEqual(["g1", "g2"]);
    });
    it("returns empty set for ungrouped scene", () => {
      const b = blocksFrom([blk(0, 0, 0), blk(3, 0, 0)]);
      expect(allGroupIds(b).size).toBe(0);
    });
  });

  describe("filterByGroup", () => {
    it("returns only matching members as a new Map", () => {
      const b = blocksFrom([
        blk(0, 0, 0, "g1"),
        blk(3, 0, 0, "g1"),
        blk(0, 3, 0, "g2"),
      ]);
      const out = filterByGroup(b, "g1");
      expect(out.size).toBe(2);
      expect(out.get("0,0,0")?.groupId).toBe("g1");
      expect(out.get("3,0,0")?.groupId).toBe("g1");
      expect(out.has("0,3,0")).toBe(false);
    });
  });

  describe("groupColor", () => {
    it("is deterministic — same id → same color", () => {
      const a = groupColor("abc12345");
      const b = groupColor("abc12345");
      expect(a).toBe(b);
    });
    it("returns one of the 8 palette colors", () => {
      const c = groupColor("anyid001");
      expect(OKABE_ITO_PALETTE).toContain(c);
    });
    it("paletteIndexFor stays in 0..7", () => {
      for (const id of ["aaaaaaaa", "00000000", "zzzzzzzz", "deadbeef"]) {
        const idx = paletteIndexFor(id);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(OKABE_ITO_PALETTE.length);
      }
    });
  });

  describe("newGroupId", () => {
    it("emits 8-char lowercase alphanumeric", () => {
      for (let i = 0; i < 10; i++) {
        const id = newGroupId();
        expect(id).toMatch(/^[0-9a-z]{8}$/);
      }
    });
    it("gives different IDs across calls (collision-resistance smoke)", () => {
      const set = new Set<string>();
      for (let i = 0; i < 200; i++) set.add(newGroupId());
      expect(set.size).toBe(200);
    });
  });

  describe("selectionGroupClassification", () => {
    const b = blocksFrom([
      blk(0, 0, 0, "g1"),
      blk(3, 0, 0, "g1"),
      blk(6, 0, 0, "g1"),
      blk(0, 3, 0, "g2"),
      blk(3, 3, 0, "g2"),
      blk(6, 3, 0),
      blk(0, 6, 0),
    ]);

    it("empty selection", () => {
      expect(selectionGroupClassification(b, new Set())).toEqual({ kind: "empty" });
    });
    it("single ungrouped", () => {
      expect(selectionGroupClassification(b, new Set(["6,3,0"]))).toEqual({ kind: "single-ungrouped" });
    });
    it("single grouped", () => {
      expect(selectionGroupClassification(b, new Set(["0,0,0"]))).toEqual({ kind: "single-grouped", groupId: "g1" });
    });
    it("≥2 all ungrouped", () => {
      expect(selectionGroupClassification(b, new Set(["6,3,0", "0,6,0"]))).toEqual({ kind: "all-ungrouped" });
    });
    it("≥2 all in same group", () => {
      const cls = selectionGroupClassification(b, new Set(["0,0,0", "3,0,0"]));
      expect(cls).toEqual({ kind: "all-same-group", groupId: "g1" });
    });
    it("mixed grouped and ungrouped", () => {
      const cls = selectionGroupClassification(b, new Set(["0,0,0", "0,6,0"]));
      expect(cls).toEqual({ kind: "mixed-grouped-ungrouped" });
    });
    it("≥2 from multiple groups", () => {
      const cls = selectionGroupClassification(b, new Set(["0,0,0", "0,3,0"]));
      expect(cls.kind).toBe("multi-group");
      if (cls.kind === "multi-group") expect(cls.groupIds.sort()).toEqual(["g1", "g2"]);
    });
  });

  describe("isTqecEligibleBlock", () => {
    it("cubes/pipes/Y are eligible", () => {
      expect(isTqecEligibleBlock({ pos: { x: 0, y: 0, z: 0 }, type: "XZZ" })).toBe(true);
      expect(isTqecEligibleBlock({ pos: { x: 0, y: 0, z: 0 }, type: "Y" })).toBe(true);
      expect(isTqecEligibleBlock({ pos: { x: 1, y: 0, z: 0 }, type: "OZX" })).toBe(true);
    });
    // Slab support is forward-compatible; this branch only fires when slabs land.
  });
});
