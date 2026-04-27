import ReactThreeTestRenderer from "@react-three/test-renderer";
import { beforeEach, describe, expect, it } from "vitest";
import { useBlockStore } from "../stores/blockStore";
import type { Block } from "../types";
import { DragShadow, MAX_SHADOWS } from "./DragShadow";

function mk(pos: { x: number; y: number; z: number }, type: Block["type"] = "XZZ"): Block {
  return { pos, type };
}

function setup(opts: {
  blocks?: Array<[string, Block]>;
  selected?: string[];
  dragDelta?: { x: number; y: number; z: number } | null;
  dragValid?: boolean;
}) {
  useBlockStore.setState(
    {
      blocks: new Map(opts.blocks ?? []),
      selectedKeys: new Set(opts.selected ?? []),
      dragDelta: opts.dragDelta ?? null,
      dragValid: opts.dragValid ?? true,
      isDraggingSelection: opts.dragDelta != null,
    },
    false,
  );
}

beforeEach(() => {
  // Hard reset all fields DragShadow reads, plus closely-related drag state.
  useBlockStore.setState(
    {
      blocks: new Map(),
      selectedKeys: new Set(),
      dragDelta: null,
      dragValid: true,
      isDraggingSelection: false,
    },
    false,
  );
});

describe("<DragShadow>", () => {
  it("renders nothing with empty selection", async () => {
    setup({});
    const r = await ReactThreeTestRenderer.create(<DragShadow />);
    expect(r.scene.findAllByType("Group")).toHaveLength(0);
  });

  it("renders one shadow per elevated selected block at rest, none for z=0 blocks", async () => {
    setup({
      blocks: [
        ["0,0,0", mk({ x: 0, y: 0, z: 0 })],
        ["0,0,3", mk({ x: 0, y: 0, z: 3 })],
        ["3,0,3", mk({ x: 3, y: 0, z: 3 })],
      ],
      selected: ["0,0,0", "0,0,3", "3,0,3"],
      dragDelta: null,
    });
    const r = await ReactThreeTestRenderer.create(<DragShadow />);
    // Two elevated blocks -> two GroundShadowAbsolute groups.
    expect(r.scene.findAllByType("Group")).toHaveLength(2);
  });

  it("renders nothing if all selected blocks are on the ground", async () => {
    setup({
      blocks: [["0,0,0", mk({ x: 0, y: 0, z: 0 })]],
      selected: ["0,0,0"],
    });
    const r = await ReactThreeTestRenderer.create(<DragShadow />);
    expect(r.scene.findAllByType("Group")).toHaveLength(0);
  });

  it("uses shifted positions when dragDelta is non-zero", async () => {
    setup({
      blocks: [["0,0,3", mk({ x: 0, y: 0, z: 3 })]],
      selected: ["0,0,3"],
      dragDelta: { x: 6, y: 0, z: 0 },
    });
    const r = await ReactThreeTestRenderer.create(<DragShadow />);
    const group = r.scene.findByType("Group");
    // Shifted block at (6, 0, 3) -> ground center cx = 6.5, cz = -0.5
    expect(group.instance.position.x).toBeCloseTo(6.5);
    expect(group.instance.position.z).toBeCloseTo(-0.5);
  });

  it("treats {0,0,0} dragDelta as at-rest mode (no shift, neutral validity)", async () => {
    setup({
      blocks: [["0,0,3", mk({ x: 0, y: 0, z: 3 })]],
      selected: ["0,0,3"],
      dragDelta: { x: 0, y: 0, z: 0 },
      dragValid: false, // would turn red if drag mode kicked in
    });
    const r = await ReactThreeTestRenderer.create(<DragShadow />);
    const mesh = r.scene.findByType("Mesh");
    const matColor = (
      mesh.instance.material as { color: { getHex: () => number } }
    ).color.getHex();
    // At-rest -> always-valid -> black mesh, not red
    expect(matColor).toBe(0x000000);
  });

  it("renders red shadows when dragValid=false during a real drag", async () => {
    setup({
      blocks: [["0,0,3", mk({ x: 0, y: 0, z: 3 })]],
      selected: ["0,0,3"],
      dragDelta: { x: 3, y: 0, z: 0 },
      dragValid: false,
    });
    const r = await ReactThreeTestRenderer.create(<DragShadow />);
    const mesh = r.scene.findByType("Mesh");
    const matColor = (
      mesh.instance.material as { color: { getHex: () => number } }
    ).color.getHex();
    expect(matColor).toBe(0xff5555);
  });

  it("caps at MAX_SHADOWS for huge selections", async () => {
    const blocks: Array<[string, Block]> = [];
    const selected: string[] = [];
    // Build 250 elevated blocks, all selected
    for (let i = 0; i < 250; i++) {
      const key = `${i * 3},0,3`;
      blocks.push([key, mk({ x: i * 3, y: 0, z: 3 })]);
      selected.push(key);
    }
    setup({ blocks, selected });
    const r = await ReactThreeTestRenderer.create(<DragShadow />);
    expect(r.scene.findAllByType("Group")).toHaveLength(MAX_SHADOWS);
  });

  it("applies yBlockZOffset to at-rest Y-cube under a pipe (visually lifted)", async () => {
    // Y-cube at logical z=0 with a pipe at z=1 above it -> visually lifted by 0.5
    setup({
      blocks: [
        ["0,0,0", mk({ x: 0, y: 0, z: 0 }, "Y")],
        ["0,0,1", mk({ x: 0, y: 0, z: 1 }, "ZXO")], // Z-open pipe above
      ],
      selected: ["0,0,0"],
    });
    const r = await ReactThreeTestRenderer.create(<DragShadow />);
    // With the lift, the Y-cube's effective z is 0.5 -> shadow appears.
    expect(r.scene.findAllByType("Group")).toHaveLength(1);
    const line = r.scene.findByType("Line");
    // Line len = 0.5 - Y_OFFSET ≈ 0.49
    expect(line.instance.scale.y).toBeCloseTo(0.49, 2);
  });

  it("does NOT apply yBlockZOffset during drag (mirrors DragGhost behavior)", async () => {
    // Y-cube being dragged from z=0 to z=3. During drag we use shifted logical
    // pos (z=3), no lift even if a pipe sits at z=4 in the destination.
    setup({
      blocks: [
        ["0,0,0", mk({ x: 0, y: 0, z: 0 }, "Y")],
        ["3,0,4", mk({ x: 3, y: 0, z: 4 }, "ZXO")], // pipe at destination top
      ],
      selected: ["0,0,0"],
      dragDelta: { x: 3, y: 0, z: 3 },
    });
    const r = await ReactThreeTestRenderer.create(<DragShadow />);
    const line = r.scene.findByType("Line");
    // Pure shifted z=3, line len = 3 - Y_OFFSET ≈ 2.99
    expect(line.instance.scale.y).toBeCloseTo(2.99, 2);
  });
});
