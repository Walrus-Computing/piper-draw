import ReactThreeTestRenderer from "@react-three/test-renderer";
import { beforeEach, describe, expect, it } from "vitest";
import { useBlockStore } from "../stores/blockStore";
import type { Block } from "../types";
import { OpenPipeGhosts } from "./OpenPipeGhosts";

function reset() {
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
      portMeta: new Map(),
      selectionPivot: null,
      undeterminedCubes: new Map(),
      freeBuild: false,
      clipboard: null,
      buildCursor: null,
      buildHistory: [],
      cameraSnapTarget: null,
      lastBuildAxis: null,
    },
    false,
  );
}

beforeEach(reset);

// A Z-open pipe at z=1 dangles ports at z=0 and z=3 (offset rule [-1, +2]).
// Putting buildCursor on one (z=0) means only the elevated port at z=3
// renders as a ghost — the cursor cell is excluded at OpenPipeGhosts.tsx:252.
function seedZElevatedPortAndCursorOnGround() {
  const pipe: Block = { pos: { x: 0, y: 0, z: 1 }, type: "ZXO" };
  const blocks = new Map<string, Block>([["0,0,1", pipe]]);
  useBlockStore.setState(
    {
      blocks,
      mode: "build",
      buildCursor: { x: 0, y: 0, z: 0 },
    },
    false,
  );
}

describe("<OpenPipeGhosts> build-mode click-to-port (issue #293)", () => {
  it("clicking a port at z>0 in build mode moves the build cursor there", async () => {
    seedZElevatedPortAndCursorOnGround();

    const r = await ReactThreeTestRenderer.create(<OpenPipeGhosts />);

    // Cursor cell (z=0) is excluded; only the elevated port at z=3 renders.
    const meshes = r.scene.findAllByType("Mesh");
    expect(meshes).toHaveLength(1);

    await r.fireEvent(meshes[0], "click", { delta: 0 });

    expect(useBlockStore.getState().buildCursor).toEqual({ x: 0, y: 0, z: 3 });
  });

  it("a drag (delta > 2) on a port ghost does NOT move the build cursor", async () => {
    seedZElevatedPortAndCursorOnGround();

    const r = await ReactThreeTestRenderer.create(<OpenPipeGhosts />);
    const meshes = r.scene.findAllByType("Mesh");
    expect(meshes).toHaveLength(1);

    await r.fireEvent(meshes[0], "click", { delta: 5 });

    // Cursor unchanged.
    expect(useBlockStore.getState().buildCursor).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("<OpenPipeGhosts> selection highlight after Ctrl+A (issue #300)", () => {
  it("renders a highlight mesh for every port after selectAll", async () => {
    // Z-open pipe at (0,0,1) → inferred ports at (0,0,-1) and (0,0,3).
    // Pre-selected cube at (3,0,0) reproduces the user-reported scenario where
    // a block is already selected when Ctrl+A is pressed.
    const cube: Block = { pos: { x: 3, y: 0, z: 0 }, type: "XZZ" };
    const pipe: Block = { pos: { x: 0, y: 0, z: 1 }, type: "ZXO" };
    const blocks = new Map<string, Block>([
      ["3,0,0", cube],
      ["0,0,1", pipe],
    ]);
    useBlockStore.setState(
      {
        blocks,
        mode: "edit",
        armedTool: "pointer",
        selectedKeys: new Set(["3,0,0"]),
      },
      false,
    );

    // Baseline: no ports selected → only the SelectablePortGhost meshes render.
    const before = await ReactThreeTestRenderer.create(<OpenPipeGhosts />);
    const beforeMeshes = before.scene.findAllByType("Mesh").length;

    useBlockStore.getState().selectAll();
    await before.update(<OpenPipeGhosts />);

    // After selectAll: 2 inferred ports get PortSelectionHighlight overlays,
    // adding 2 more meshes. Both selectedPortPositions entries should render.
    const afterMeshes = before.scene.findAllByType("Mesh").length;
    expect(useBlockStore.getState().selectedPortPositions.size).toBe(2);
    expect(afterMeshes - beforeMeshes).toBe(2);
  });
});
