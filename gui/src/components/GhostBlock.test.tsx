import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { useBlockStore } from "../stores/blockStore";
import type { Block, BlockType, Position3D } from "../types";
import { GhostBlock } from "./GhostBlock";

function mk(pos: Position3D, type: BlockType = "XZZ"): Block {
  return { pos, type };
}

beforeEach(() => {
  useBlockStore.setState(
    {
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
      hoveredReplace: false,
      selectedKeys: new Set(),
      selectedPortPositions: new Set(),
      portPositions: new Set(),
      selectionPivot: null,
      undeterminedCubes: new Map(),
      freeBuild: false,
      clipboard: null,
    },
    false,
  );
});

describe("<GhostBlock>", () => {
  it("renders nothing when hoveredGridPos is null", async () => {
    useBlockStore.setState({ hoveredGridPos: null }, false);
    const r = await ReactThreeTestRenderer.create(<GhostBlock />);
    expect(r.scene.children).toHaveLength(0);
  });

  it("renders nothing in build mode", async () => {
    useBlockStore.setState(
      { hoveredGridPos: { x: 0, y: 0, z: 2 }, mode: "build" },
      false,
    );
    const r = await ReactThreeTestRenderer.create(<GhostBlock />);
    expect(r.scene.children).toHaveLength(0);
  });

  it("renders nothing in edit mode when armedTool is pointer", async () => {
    useBlockStore.setState(
      { hoveredGridPos: { x: 0, y: 0, z: 2 }, armedTool: "pointer" },
      false,
    );
    const r = await ReactThreeTestRenderer.create(<GhostBlock />);
    expect(r.scene.children).toHaveLength(0);
  });

  it("renders nothing in edit mode when armedTool is paste", async () => {
    useBlockStore.setState(
      { hoveredGridPos: { x: 0, y: 0, z: 2 }, armedTool: "paste" },
      false,
    );
    const r = await ReactThreeTestRenderer.create(<GhostBlock />);
    expect(r.scene.children).toHaveLength(0);
  });

  it("renders cube ghost only (no shadow) at ground level", async () => {
    useBlockStore.setState(
      { hoveredGridPos: { x: 0, y: 0, z: 0 }, armedTool: "cube", cubeType: "XZZ" },
      false,
    );
    const r = await ReactThreeTestRenderer.create(<GhostBlock />);
    // The ghost itself is one positioned group + inner scaled group; no second
    // GroundShadowAbsolute group because z=0 -> shouldRenderShadow false.
    const groups = r.scene.findAllByType("Group");
    // 1 outer positioned group + 1 inner scaled group = 2 (no shadow group)
    expect(groups.length).toBe(2);
  });

  it("renders cube ghost + GroundShadowAbsolute at z=2", async () => {
    useBlockStore.setState(
      { hoveredGridPos: { x: 0, y: 0, z: 2 }, armedTool: "cube", cubeType: "XZZ" },
      false,
    );
    const r = await ReactThreeTestRenderer.create(<GhostBlock />);
    const groups = r.scene.findAllByType("Group");
    // ghost outer + ghost inner-scaled + GroundShadowAbsolute world-positioned group = 3
    expect(groups.length).toBe(3);
    // 2 LineSegments: ghost-block edges (existing) + shadow projection line (new).
    expect(r.scene.findAllByType("LineSegments")).toHaveLength(2);
  });

  it("Y-cube placement preview at z=0 with pipe above gets a lifted shadow", async () => {
    // A Z-open pipe sits at z=1 directly above the hovered Y placement at z=0.
    // yBlockZOffset returns 0.5 → effective z = 0.5 → shadow renders.
    useBlockStore.setState(
      {
        hoveredGridPos: { x: 0, y: 0, z: 0 },
        armedTool: "cube",
        cubeType: "Y",
        blocks: new Map([["0,0,1", mk({ x: 0, y: 0, z: 1 }, "ZXO")]]),
      },
      false,
    );
    const r = await ReactThreeTestRenderer.create(<GhostBlock />);
    // Without the yBlockZOffset adjustment, no shadow would render (logical z=0).
    // With it, effective z=0.5 → shadow + line appear. 2 LineSegments total:
    // ghost-block edges + shadow projection line.
    expect(r.scene.findAllByType("LineSegments")).toHaveLength(2);
  });

  it("port placement preview at z=2 renders port ghost + GroundShadow", async () => {
    useBlockStore.setState(
      { hoveredGridPos: { x: 0, y: 0, z: 2 }, armedTool: "port" },
      false,
    );
    const r = await ReactThreeTestRenderer.create(<GhostBlock />);
    // Port ghost positioned group + GroundShadowAbsolute group = 2
    const groups = r.scene.findAllByType("Group");
    expect(groups.length).toBe(2);
    // port-ghost edges (existing) + shadow line (new) = 2 LineSegments.
    expect(r.scene.findAllByType("LineSegments")).toHaveLength(2);
  });

  it("isInvalid hover at z=2 renders red shadow (invalid color)", async () => {
    useBlockStore.setState(
      {
        hoveredGridPos: { x: 0, y: 0, z: 2 },
        armedTool: "cube",
        cubeType: "XZZ",
        hoveredInvalid: true,
      },
      false,
    );
    const r = await ReactThreeTestRenderer.create(<GhostBlock />);
    // Both the ghost edges and the shadow line render in red for invalid hover.
    // GhostBlock uses #ff0000 lineMaterial; GroundShadowAbsolute uses #ff0000.
    // Assert all LineSegments are red.
    const lines = r.scene.findAllByType("LineSegments");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      const mat = (line.instance as THREE.LineSegments).material as THREE.LineBasicMaterial;
      expect(mat.color.getHex()).toBe(0xff0000);
    }
  });

  it("isDelete (xHeld in edit mode) renders delete preview but NO shadow", async () => {
    // xHeld + edit mode = isDelete. We render the existing block being targeted
    // for removal in red, but explicitly do NOT add a ground shadow (it's a
    // "remove this" cue, not a "place here" cue).
    useBlockStore.setState(
      {
        hoveredGridPos: { x: 0, y: 0, z: 2 },
        armedTool: "cube",
        cubeType: "XZZ",
        xHeld: true,
      },
      false,
    );
    const r = await ReactThreeTestRenderer.create(<GhostBlock />);
    // Delete branch renders only a mesh (no edges). No shadow either.
    expect(r.scene.findAllByType("LineSegments")).toHaveLength(0);
  });
});
