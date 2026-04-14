import { describe, expect, it } from "vitest";
import { parseDaeToBlocks } from "./daeImport";

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
});
