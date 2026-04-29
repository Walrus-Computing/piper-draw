import { describe, expect, it } from "vitest";
import {
  ELEVATION_FALLOFF_FLOOR,
  GROUND_EPSILON,
  INVALID_LINE_COLOR,
  INVALID_LINE_OPACITY,
  INVALID_MESH_OPACITY,
  INVALID_SHADOW_COLOR,
  VALID_LINE_COLOR,
  VALID_LINE_OPACITY,
  VALID_MESH_OPACITY,
  VALID_SHADOW_COLOR,
  Y_OFFSET,
  elevationFactor,
  shadowVisuals,
  shouldRenderShadow,
} from "./groundShadow";

describe("shouldRenderShadow", () => {
  it.each<[number, boolean, string]>([
    [0, false, "exactly on ground"],
    [GROUND_EPSILON, false, "exactly at GROUND_EPSILON"],
    [0.001, true, "just above epsilon"],
    [1, true, "z=1 cube above ground"],
    [30, true, "very tall block"],
    [-1, false, "below ground (defensive)"],
    [-0.5, false, "Y-cube below ground (defensive)"],
  ])("z=%s -> %s (%s)", (z, expected) => {
    expect(shouldRenderShadow({ x: 0, y: 0, z })).toBe(expected);
  });
});

describe("elevationFactor", () => {
  it("returns 1 at z=0 (no fade below z=1)", () => {
    expect(elevationFactor(0)).toBe(1);
  });

  it("returns 1 at z=1 (full opacity baseline)", () => {
    expect(elevationFactor(1)).toBe(1);
  });

  it("decreases monotonically between z=1 and z=30", () => {
    let prev = elevationFactor(1);
    for (let z = 2; z <= 30; z++) {
      const cur = elevationFactor(z);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });

  it("hits the floor at high z and stays there", () => {
    // Pure formula at z=30 = 1/3.32 = 0.301, just above floor.
    // Floor engages around z=30.17. Test slightly past that point.
    expect(elevationFactor(31)).toBe(ELEVATION_FALLOFF_FLOOR);
    expect(elevationFactor(50)).toBe(ELEVATION_FALLOFF_FLOOR);
    expect(elevationFactor(100)).toBe(ELEVATION_FALLOFF_FLOOR);
  });

  it("floors at ELEVATION_FALLOFF_FLOOR even at z=10000", () => {
    expect(elevationFactor(10000)).toBe(ELEVATION_FALLOFF_FLOOR);
  });

  it("z=8 ~ 0.61 (sanity-check the curve)", () => {
    expect(elevationFactor(8)).toBeCloseTo(0.6410, 3);
  });

  it("z=16 ~ 0.45", () => {
    expect(elevationFactor(16)).toBeCloseTo(0.4545, 3);
  });
});

describe("shadowVisuals", () => {
  describe("footprint sizing", () => {
    it("centers a 1x1 cube at (pos.x + 0.5, -(pos.y + 0.5))", () => {
      const v = shadowVisuals({ x: 3, y: 6, z: 2 }, "XZZ", true);
      expect(v.cx).toBe(3.5);
      expect(v.cz).toBe(-6.5);
    });

    it("uses 2x1 footprint for X-open pipe (OZX): cx offset 1, cz offset 0.5", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 2 }, "OZX", true);
      // OZX is [2, 1, 1] in TQEC -> ground footprint sx=2, sy=1
      expect(v.cx).toBe(1);
      expect(v.cz).toBe(-0.5);
    });

    it("uses 1x2 footprint for Y-open pipe (ZOX): cx offset 0.5, cz offset 1", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 2 }, "ZOX", true);
      // ZOX is [1, 2, 1] in TQEC -> ground footprint sx=1, sy=2
      expect(v.cx).toBe(0.5);
      expect(v.cz).toBe(-1);
    });

    it("uses 1x1 footprint for Z-open pipe (ZXO)", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 2 }, "ZXO", true);
      // ZXO is [1, 1, 2] in TQEC -> ground footprint sx=1, sy=1 (z is open axis)
      expect(v.cx).toBe(0.5);
      expect(v.cz).toBe(-0.5);
    });

    it("uses 1x1 footprint for Y half-cube (sz=0.5 ignored for ground)", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 2 }, "Y", true);
      expect(v.cx).toBe(0.5);
      expect(v.cz).toBe(-0.5);
    });
  });

  describe("lineLen", () => {
    it("uses pos.z (block bottom), not pos.z + sz (block top)", () => {
      // Y half-cube at z=2: top is at 2.5, but lineLen must use 2.
      const v = shadowVisuals({ x: 0, y: 0, z: 2 }, "Y", true);
      expect(v.lineLen).toBeCloseTo(2 - Y_OFFSET, 6);
    });

    it("computes correctly for a tall block", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 8 }, "XZZ", true);
      expect(v.lineLen).toBeCloseTo(8 - Y_OFFSET, 6);
    });
  });

  describe("opacity & elevation falloff", () => {
    it("applies falloff to valid mesh+line opacity", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 8 }, "XZZ", true);
      expect(v.meshOpacity).toBeCloseTo(VALID_MESH_OPACITY * elevationFactor(8), 6);
      expect(v.lineOpacity).toBeCloseTo(VALID_LINE_OPACITY * elevationFactor(8), 6);
    });

    it("does NOT apply falloff when valid=false (full strength)", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 30 }, "XZZ", false);
      expect(v.meshOpacity).toBe(INVALID_MESH_OPACITY);
      expect(v.lineOpacity).toBe(INVALID_LINE_OPACITY);
    });

    it("at z=1, valid mesh opacity == VALID_MESH_OPACITY (no fade)", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 1 }, "XZZ", true);
      expect(v.meshOpacity).toBe(VALID_MESH_OPACITY);
      expect(v.lineOpacity).toBe(VALID_LINE_OPACITY);
    });

    it("at high z, valid mesh opacity hits floor (30% of base)", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 50 }, "XZZ", true);
      expect(v.meshOpacity).toBeCloseTo(VALID_MESH_OPACITY * ELEVATION_FALLOFF_FLOOR, 6);
    });
  });

  describe("colors", () => {
    it("uses #000/#000 for valid", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 2 }, "XZZ", true);
      expect(v.meshColor).toBe(VALID_SHADOW_COLOR);
      expect(v.lineColor).toBe(VALID_LINE_COLOR);
    });

    it("uses #ff5555/#ff0000 for invalid", () => {
      const v = shadowVisuals({ x: 0, y: 0, z: 2 }, "XZZ", false);
      expect(v.meshColor).toBe(INVALID_SHADOW_COLOR);
      expect(v.lineColor).toBe(INVALID_LINE_COLOR);
    });
  });
});
