import { describe, expect, it } from "vitest";
import { snapPasteDelta, fallbackPasteDelta } from "./pasteMath";
import type { Block } from "../types";

function blockMap(
  items: Array<{ x: number; y: number; z: number; type: Block["type"] }>,
): Map<string, Block> {
  const m = new Map<string, Block>();
  for (const b of items) {
    m.set(`${b.x},${b.y},${b.z}`, { pos: { x: b.x, y: b.y, z: b.z }, type: b.type });
  }
  return m;
}

describe("snapPasteDelta", () => {
  it("floors each axis to the 3-unit block period", () => {
    expect(snapPasteDelta({ x: 5, y: 4, z: 3 })).toEqual({ x: 3, y: 3, z: 3 });
    expect(snapPasteDelta({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("floors negative coordinates downward", () => {
    expect(snapPasteDelta({ x: -1, y: -3, z: -4 })).toEqual({ x: -3, y: -3, z: -6 });
  });
});

describe("fallbackPasteDelta", () => {
  it("returns zero delta for an empty scene", () => {
    const incoming = blockMap([{ x: 0, y: 0, z: 0, type: "ZXZ" }]);
    expect(fallbackPasteDelta(new Map(), incoming)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("offsets one block period past the scene's +X extent", () => {
    const existing = blockMap([{ x: 0, y: 0, z: 0, type: "ZXZ" }]);
    const incoming = blockMap([{ x: 0, y: 0, z: 0, type: "ZXZ" }]);
    expect(fallbackPasteDelta(existing, incoming)).toEqual({ x: 3, y: 0, z: 0 });
  });

  it("stays a multiple of 3 when extents sit on pipe slots", () => {
    const existing = blockMap([
      { x: 0, y: 0, z: 0, type: "ZXZ" },
      { x: 1, y: 0, z: 0, type: "OXZ" },
    ]);
    const incoming = blockMap([{ x: 0, y: 0, z: 0, type: "ZXZ" }]);
    const delta = fallbackPasteDelta(existing, incoming);
    expect(delta.x % 3).toBe(0);
    expect(delta.x).toBeGreaterThan(1);
  });
});
