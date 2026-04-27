import ReactThreeTestRenderer from "@react-three/test-renderer";
import { beforeEach, describe, expect, it } from "vitest";
import { useBlockStore } from "../stores/blockStore";
import type { Block, BlockType, Position3D } from "../types";
import { PasteGhost } from "./PasteGhost";

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

function setPaste(opts: {
  clipboard?: Map<string, Block>;
  hoveredGridPos?: Position3D | null;
  blocks?: Map<string, Block>;
}) {
  useBlockStore.setState(
    {
      armedTool: "paste",
      mode: "edit",
      clipboard: opts.clipboard ?? null,
      hoveredGridPos: opts.hoveredGridPos ?? null,
      blocks: opts.blocks ?? new Map(),
    },
    false,
  );
}

describe("<PasteGhost>", () => {
  it("renders nothing when armedTool is not paste", async () => {
    useBlockStore.setState(
      {
        armedTool: "cube",
        clipboard: new Map([["0,0,0", mk({ x: 0, y: 0, z: 0 })]]),
        hoveredGridPos: { x: 3, y: 0, z: 0 },
      },
      false,
    );
    const r = await ReactThreeTestRenderer.create(<PasteGhost />);
    expect(r.scene.children).toHaveLength(0);
  });

  it("renders nothing with empty/null clipboard", async () => {
    setPaste({ clipboard: null, hoveredGridPos: { x: 0, y: 0, z: 0 } });
    const r = await ReactThreeTestRenderer.create(<PasteGhost />);
    expect(r.scene.children).toHaveLength(0);
  });

  it("renders nothing without a hovered grid pos", async () => {
    setPaste({
      clipboard: new Map([["0,0,0", mk({ x: 0, y: 0, z: 0 })]]),
      hoveredGridPos: null,
    });
    const r = await ReactThreeTestRenderer.create(<PasteGhost />);
    expect(r.scene.children).toHaveLength(0);
  });

  it("renders one paste-ghost per clipboard entry at z=0 (no shadows)", async () => {
    setPaste({
      clipboard: new Map([
        ["0,0,0", mk({ x: 0, y: 0, z: 0 })],
        ["3,0,0", mk({ x: 3, y: 0, z: 0 })],
      ]),
      hoveredGridPos: { x: 0, y: 0, z: 0 },
    });
    const r = await ReactThreeTestRenderer.create(<PasteGhost />);
    // 2 ghost meshes; no Lines because no GroundShadowAbsolute fires at z=0.
    expect(r.scene.findAllByType("Mesh")).toHaveLength(2);
    expect(r.scene.findAllByType("Line")).toHaveLength(0);
  });

  it("renders shadow + projection line for elevated paste-ghost block", async () => {
    setPaste({
      clipboard: new Map([["0,0,3", mk({ x: 0, y: 0, z: 3 })]]),
      hoveredGridPos: { x: 0, y: 0, z: 0 },
    });
    const r = await ReactThreeTestRenderer.create(<PasteGhost />);
    // 1 ghost mesh + 1 shadow mesh = 2; 1 projection line
    expect(r.scene.findAllByType("Mesh")).toHaveLength(2);
    expect(r.scene.findAllByType("Line")).toHaveLength(1);
  });

  it("turns shadow red when paste collides with existing block", async () => {
    setPaste({
      clipboard: new Map([["0,0,3", mk({ x: 0, y: 0, z: 3 })]]),
      hoveredGridPos: { x: 0, y: 0, z: 0 },
      blocks: new Map([["0,0,3", mk({ x: 0, y: 0, z: 3 })]]), // collision
    });
    const r = await ReactThreeTestRenderer.create(<PasteGhost />);
    const line = r.scene.findByType("Line");
    const lineColor = (
      line.instance.material as { color: { getHex: () => number } }
    ).color.getHex();
    expect(lineColor).toBe(0xff0000);
  });

  it("Y-cube paste at z=0 with pipe above gets a lifted shadow", async () => {
    // Clipboard contains a Y-cube at z=0; paste destination has a pipe at z=1
    // directly above. yBlockZOffset returns 0.5 -> shadow renders.
    setPaste({
      clipboard: new Map([["0,0,0", mk({ x: 0, y: 0, z: 0 }, "Y")]]),
      hoveredGridPos: { x: 0, y: 0, z: 0 },
      blocks: new Map([["0,0,1", mk({ x: 0, y: 0, z: 1 }, "ZXO")]]),
    });
    const r = await ReactThreeTestRenderer.create(<PasteGhost />);
    expect(r.scene.findAllByType("Line")).toHaveLength(1);
  });

  it("caps clipboard at 200 entries (MAX_PASTE_SHADOWS)", async () => {
    // Build a clipboard with 250 elevated blocks
    const big = new Map<string, Block>();
    for (let i = 0; i < 250; i++) {
      big.set(`${i * 3},0,3`, mk({ x: i * 3, y: 0, z: 3 }));
    }
    setPaste({
      clipboard: big,
      hoveredGridPos: { x: 0, y: 0, z: 0 },
    });
    const r = await ReactThreeTestRenderer.create(<PasteGhost />);
    // 200 paste-ghost meshes + 200 shadow meshes = 400 total
    expect(r.scene.findAllByType("Mesh")).toHaveLength(400);
    expect(r.scene.findAllByType("Line")).toHaveLength(200);
  });
});
