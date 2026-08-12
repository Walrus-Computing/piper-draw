import { describe, expect, it } from "vitest";
import { parseDaeToBlocks, canonicaliseImportedCubes, daeImportSummaryMessage, type DaeImportSummary } from "./daeImport";
import type { Block } from "../types";

/** Minimal valid DAE with a single block instance. */
function minimalDae(
  kindName: string,
  matrix = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1",
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><up_axis>Z_UP</up_axis></asset>
  <library_nodes>
    <node id="lib1" name="${kindName}" type="NODE">
      <instance_geometry url="#geom1"/>
    </node>
  </library_nodes>
  <library_visual_scenes>
    <visual_scene id="scene1" name="scene">
      <node id="sk" name="SketchUp" type="NODE">
        <node id="inst0" name="instance_0" type="NODE">
          <matrix>${matrix}</matrix>
          <instance_node url="#lib1"/>
        </node>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene1"/></scene>
</COLLADA>`;
}

describe("parseDaeToBlocks", () => {
  it("parses a single cube at origin", () => {
    const blocks = parseDaeToBlocks(minimalDae("xzz"));
    expect(blocks.size).toBe(1);
    const b = blocks.get("0,0,0");
    expect(b).toBeDefined();
    expect(b!.type).toBe("XZZ");
  });

  it("handles uppercase and lowercase kind names", () => {
    const lower = parseDaeToBlocks(minimalDae("zxz"));
    expect(lower.get("0,0,0")!.type).toBe("ZXZ");

    const upper = parseDaeToBlocks(minimalDae("ZXZ"));
    expect(upper.get("0,0,0")!.type).toBe("ZXZ");
  });

  it("extracts position from matrix translation", () => {
    const blocks = parseDaeToBlocks(minimalDae("xzz", "1 0 0 6 0 1 0 3 0 0 1 9 0 0 0 1"));
    expect(blocks.size).toBe(1);
    const b = blocks.get("6,3,9");
    expect(b).toBeDefined();
    expect(b!.pos).toEqual({ x: 6, y: 3, z: 9 });
  });

  it("parses pipe types", () => {
    const blocks = parseDaeToBlocks(minimalDae("ozx", "1 0 0 1 0 1 0 0 0 0 1 0 0 0 0 1"));
    expect(blocks.size).toBe(1);
    expect(blocks.get("1,0,0")!.type).toBe("OZX");
  });

  it("parses Hadamard pipe types", () => {
    const blocks = parseDaeToBlocks(minimalDae("ozxh", "1 0 0 1 0 1 0 0 0 0 1 0 0 0 0 1"));
    expect(blocks.size).toBe(1);
    expect(blocks.get("1,0,0")!.type).toBe("OZXH");
  });

  it("parses Y half-cube", () => {
    const blocks = parseDaeToBlocks(minimalDae("y"));
    expect(blocks.size).toBe(1);
    expect(blocks.get("0,0,0")!.type).toBe("Y");
  });

  it("skips PORT nodes", () => {
    const blocks = parseDaeToBlocks(minimalDae("PORT"));
    expect(blocks.size).toBe(0);
  });

  it("skips correlation surface nodes", () => {
    const blocks = parseDaeToBlocks(minimalDae("X_CORRELATION"));
    expect(blocks.size).toBe(0);
  });

  it("throws on missing SketchUp node", () => {
    const xml = `<?xml version="1.0"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <library_visual_scenes>
    <visual_scene id="s"><node name="NotSketchUp"/></visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#s"/></scene>
</COLLADA>`;
    expect(() => parseDaeToBlocks(xml)).toThrow("SketchUp");
  });

  it("handles multiple blocks in one file", () => {
    const xml = `<?xml version="1.0"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <library_nodes>
    <node id="lib_xzz" name="xzz" type="NODE"><instance_geometry url="#g1"/></node>
    <node id="lib_zxz" name="zxz" type="NODE"><instance_geometry url="#g2"/></node>
  </library_nodes>
  <library_visual_scenes>
    <visual_scene id="s" name="scene">
      <node name="SketchUp" type="NODE">
        <node id="i0" type="NODE">
          <matrix>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>
          <instance_node url="#lib_xzz"/>
        </node>
        <node id="i1" type="NODE">
          <matrix>1 0 0 3 0 1 0 0 0 0 1 0 0 0 0 1</matrix>
          <instance_node url="#lib_zxz"/>
        </node>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#s"/></scene>
</COLLADA>`;
    const blocks = parseDaeToBlocks(xml);
    expect(blocks.size).toBe(2);
    expect(blocks.get("0,0,0")!.type).toBe("XZZ");
    expect(blocks.get("3,0,0")!.type).toBe("ZXZ");
  });

  it("handles 90-degree rotation around Z axis (XZZ → ZXZ)", () => {
    // 90° CCW around Z: [[0,-1,0],[1,0,0],[0,0,1]]
    // Row-major 4x4: 0 -1 0 tx  1 0 0 ty  0 0 1 tz  0 0 0 1
    const mat = "0 -1 0 0 1 0 0 0 0 0 1 0 0 0 0 1";
    const blocks = parseDaeToBlocks(minimalDae("xzz", mat));
    expect(blocks.size).toBe(1);
    // XZZ rotated 90° around Z should permute X↔Y faces → ZXZ
    const b = Array.from(blocks.values())[0];
    expect(b.type).toBe("ZXZ");
  });

  it("handles Y half-cube with 0.5 Z offset", () => {
    // Y block at z=0.5 should be imported as z=0
    const mat = "1 0 0 0 0 1 0 0 0 0 1 0.5 0 0 0 1";
    const blocks = parseDaeToBlocks(minimalDae("y", mat));
    expect(blocks.size).toBe(1);
    expect(blocks.get("0,0,0")!.type).toBe("Y");
  });

  it("throws on invalid XML", () => {
    expect(() => parseDaeToBlocks("not xml at all<>")).toThrow();
  });

  it("canonicalises a sandwiched cube to the first valid CUBE_TYPES entry", () => {
    // Two OZX pipes along X axis flanking a cube at origin. Given OZX pipes,
    // valid CUBE_TYPES at (0,0,0) are {ZZX, XZX}; canonical is ZZX (first in order).
    // Import the non-canonical XZX — expect it to be normalised to ZZX.
    const xml = `<?xml version="1.0"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <library_nodes>
    <node id="lib_cube" name="xzx" type="NODE"><instance_geometry url="#g1"/></node>
    <node id="lib_pipe" name="ozx" type="NODE"><instance_geometry url="#g2"/></node>
  </library_nodes>
  <library_visual_scenes>
    <visual_scene id="s" name="scene">
      <node name="SketchUp" type="NODE">
        <node id="c" type="NODE">
          <matrix>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>
          <instance_node url="#lib_cube"/>
        </node>
        <node id="p1" type="NODE">
          <matrix>1 0 0 1 0 1 0 0 0 0 1 0 0 0 0 1</matrix>
          <instance_node url="#lib_pipe"/>
        </node>
        <node id="p2" type="NODE">
          <matrix>1 0 0 -2 0 1 0 0 0 0 1 0 0 0 0 1</matrix>
          <instance_node url="#lib_pipe"/>
        </node>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#s"/></scene>
</COLLADA>`;
    const blocks = parseDaeToBlocks(xml);
    expect(blocks.get("0,0,0")!.type).toBe("ZZX");
    expect(blocks.get("1,0,0")!.type).toBe("OZX");
    expect(blocks.get("-2,0,0")!.type).toBe("OZX");
  });

  it("leaves an isolated cube's type unchanged on import", () => {
    // A cube with no adjacent pipes is not canonicalised — the user's declared
    // type is preserved. Only pipe-constrained ambiguity triggers canonicalisation.
    const blocks = parseDaeToBlocks(minimalDae("zxz"));
    expect(blocks.get("0,0,0")!.type).toBe("ZXZ");
  });
});

function blockMap(
  items: Array<{ x: number; y: number; z: number; type: Block["type"] }>,
): Map<string, Block> {
  const m = new Map<string, Block>();
  for (const b of items) {
    m.set(`${b.x},${b.y},${b.z}`, { pos: { x: b.x, y: b.y, z: b.z }, type: b.type });
  }
  return m;
}

describe("canonicaliseImportedCubes — repair of pipe-conflicting cube types", () => {
  it("repairs a cube whose pipes fully determine a different type (ftdp junction convention)", () => {
    // X-pipes on both x-ends and Y-pipes on both y-ends force XXZ; ftdp
    // exports such junction cubes as xzz (pattern from adder_35bit_6x6.dae).
    // Left unrepaired, the cube fails every color-rule check as imported,
    // which vetoes any whole-scene rotation/flip.
    const blocks = blockMap([
      { x: 3, y: 3, z: 0, type: "XZZ" },
      { x: 4, y: 3, z: 0, type: "OXZ" },
      { x: 1, y: 3, z: 0, type: "OXZ" },
      { x: 3, y: 4, z: 0, type: "XOZ" },
      { x: 3, y: 1, z: 0, type: "XOZ" },
    ]);
    const { repaired, canonicalised } = canonicaliseImportedCubes(blocks);
    expect(blocks.get("3,3,0")!.type).toBe("XXZ");
    expect(repaired).toBe(1);
    expect(canonicalised).toBe(0);
  });

  it("leaves a determined cube alone when its declared type already matches", () => {
    const blocks = blockMap([
      { x: 3, y: 3, z: 0, type: "XXZ" },
      { x: 4, y: 3, z: 0, type: "OXZ" },
      { x: 1, y: 3, z: 0, type: "OXZ" },
      { x: 3, y: 4, z: 0, type: "XOZ" },
      { x: 3, y: 1, z: 0, type: "XOZ" },
    ]);
    const { repaired, canonicalised } = canonicaliseImportedCubes(blocks);
    expect(blocks.get("3,3,0")!.type).toBe("XXZ");
    expect(repaired).toBe(0);
    expect(canonicalised).toBe(0);
  });

  it("repairs a conflicting declared type to the canonical-first valid option", () => {
    // Two colinear X-open pipes leave {ZXZ, XXZ}; the declared ZZX conflicts
    // with both, so the cube is repaired to ZXZ (first in CUBE_TYPES order).
    const blocks = blockMap([
      { x: 3, y: 0, z: 0, type: "ZZX" },
      { x: 4, y: 0, z: 0, type: "OXZ" },
      { x: 1, y: 0, z: 0, type: "OXZ" },
    ]);
    const { repaired } = canonicaliseImportedCubes(blocks);
    expect(blocks.get("3,0,0")!.type).toBe("ZXZ");
    expect(repaired).toBe(1);
  });

  it("does not repair when the pipes themselves conflict (no valid type exists)", () => {
    // OXZ (y=X, z=Z) vs OZX (y=Z, z=X) — no cube type satisfies both, so the
    // block is left as declared for Verify to flag.
    const blocks = blockMap([
      { x: 3, y: 0, z: 0, type: "XZZ" },
      { x: 4, y: 0, z: 0, type: "OXZ" },
      { x: 1, y: 0, z: 0, type: "OZX" },
    ]);
    const { repaired, canonicalised } = canonicaliseImportedCubes(blocks);
    expect(blocks.get("3,0,0")!.type).toBe("XZZ");
    expect(repaired).toBe(0);
    expect(canonicalised).toBe(0);
  });
});

describe("canonicaliseImportedCubes — single-pipe cubes", () => {
  it("repairs a single-pipe cube whose declared type conflicts with that pipe", () => {
    // One OXZ pipe requires y=X, z=Z (options {ZXZ, XXZ}); the declared XZZ
    // conflicts. Even one attached pipe makes the conflict fail every
    // color-rule check as imported, so it must be repaired (to ZXZ,
    // canonical-first among the options).
    const blocks = blockMap([
      { x: 3, y: 0, z: 0, type: "XZZ" },
      { x: 4, y: 0, z: 0, type: "OXZ" },
    ]);
    const { repaired, canonicalised } = canonicaliseImportedCubes(blocks);
    expect(blocks.get("3,0,0")!.type).toBe("ZXZ");
    expect(repaired).toBe(1);
    expect(canonicalised).toBe(0);
  });

  it("preserves a single-pipe cube whose declared type is valid (no canonicalising)", () => {
    // XXZ is also compatible with a lone OXZ pipe; a valid declared type on a
    // 1-pipe cube must never be rewritten to the canonical-first option.
    const blocks = blockMap([
      { x: 3, y: 0, z: 0, type: "XXZ" },
      { x: 4, y: 0, z: 0, type: "OXZ" },
    ]);
    const { repaired, canonicalised } = canonicaliseImportedCubes(blocks);
    expect(blocks.get("3,0,0")!.type).toBe("XXZ");
    expect(repaired).toBe(0);
    expect(canonicalised).toBe(0);
  });
});

describe("import summary", () => {
  it("parseDaeToBlocks reports the summary only via the callback (silent by default)", () => {
    let summary: DaeImportSummary | null = null;
    parseDaeToBlocks(minimalDae("bogus"), (s) => { summary = s; });
    expect(summary).not.toBeNull();
    expect([...summary!.skipped.keys()]).toEqual(["BOGUS"]);
    // Omitting the callback (templates path) must not throw.
    expect(() => parseDaeToBlocks(minimalDae("bogus"))).not.toThrow();
  });

  it("daeImportSummaryMessage composes counts and returns null when clean", () => {
    expect(
      daeImportSummaryMessage({ skipped: new Map(), repaired: 0, canonicalised: 0 }),
    ).toBeNull();
    const msg = daeImportSummaryMessage({
      skipped: new Map([["OXX", 1]]),
      repaired: 2,
      canonicalised: 1,
    });
    expect(msg).toContain("1 unsupported node skipped (OXX)");
    expect(msg).toContain("2 cube types repaired");
    expect(msg).toContain("1 ambiguous cube type canonicalised");
  });
});
