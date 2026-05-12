import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  equisetaToBlocks,
  summarizeError,
  summarizeSuccess,
  type ImportResult,
  type ImportSuccess,
} from "./equisetaImport";
import { parseFtqcGraph, type FaceColor, type FtqcGraph, type RidgeId } from "./equisetaJsonSchema";
import { isValidBlockPos, isValidPipePos, isPipeType, isSlabType, isValidSlabPos } from "../types";

const FIXTURES_DIR = join(process.cwd(), "public", "equiseta-examples");

function loadFixture(name: string): FtqcGraph {
  const text = readFileSync(join(FIXTURES_DIR, name), "utf8");
  const r = parseFtqcGraph(JSON.parse(text));
  if (!r.ok) {
    throw new Error(`fixture ${name} failed schema parse: ${r.path}`);
  }
  return r.value;
}

// Helper: assert ok and narrow.
function assertSuccess(r: ImportResult): asserts r is ImportSuccess {
  if (!r.ok) throw new Error(`expected ok=true, got reason=${r.reason}`);
  if (r.empty) throw new Error("expected non-empty success, got empty");
}

// Synthetic-fixture builders.
const RIDGE_KEYS: RidgeId[] = [
  "I_BOT_SOUTH",
  "I_BOT_NORTH",
  "I_TOP_SOUTH",
  "I_TOP_NORTH",
  "J_BOT_WEST",
  "J_BOT_EAST",
  "J_TOP_WEST",
  "J_TOP_EAST",
  "K_SOUTH_WEST",
  "K_SOUTH_EAST",
  "K_NORTH_WEST",
  "K_NORTH_EAST",
];

function stubRidges(): Record<RidgeId, boolean | null> {
  const out = {} as Record<RidgeId, boolean | null>;
  for (const k of RIDGE_KEYS) out[k] = null;
  return out;
}

function buildNode(faces: Record<string, FaceColor>, coord: [number, number, number] = [0, 0, 0]) {
  return {
    coordinate: coord,
    faces: {
      east: faces.east ?? "red",
      west: faces.west ?? "red",
      north: faces.north ?? "red",
      south: faces.south ?? "red",
      top: faces.top ?? "red",
      bottom: faces.bottom ?? "red",
    },
    ridges: stubRidges(),
  };
}

// ---------------------------------------------------------------------------
// Suite 1: Happy paths — fixture → expected result table (D7')
// ---------------------------------------------------------------------------

describe("equisetaToBlocks — bundled fixture coverage (D7')", () => {
  it("zxx_memory.json → ZZX cube at origin, no satellites", () => {
    const r = equisetaToBlocks(loadFixture("zxx_memory.json"));
    assertSuccess(r);
    expect(r.cubeType).toBe("ZZX");
    expect(r.blocks.size).toBe(1);
    expect(r.portCount).toBe(0);
    expect(r.hadamardCount).toBe(0);
    const block = r.blocks.get("0,0,0");
    expect(block?.type).toBe("ZZX");
    expect(block?.pos).toEqual({ x: 0, y: 0, z: 0 });
    expect(block?.groupId).toBe(r.groupId);
  });

  it("xzz_memory.json → XXZ cube at origin", () => {
    const r = equisetaToBlocks(loadFixture("xzz_memory.json"));
    assertSuccess(r);
    expect(r.cubeType).toBe("XXZ");
    expect(r.blocks.size).toBe(1);
    expect(r.portCount).toBe(0);
  });

  it("port_io.json → XXZ cube + 2 port markers on Z-axis", () => {
    const r = equisetaToBlocks(loadFixture("port_io.json"));
    assertSuccess(r);
    expect(r.cubeType).toBe("XXZ");
    expect(r.blocks.size).toBe(1);
    expect(r.portCount).toBe(2);
    expect(r.hadamardCount).toBe(0);
    expect(r.portPositions.has("0,0,1")).toBe(true);
    expect(r.portPositions.has("0,0,-1")).toBe(true);
  });

  it("y_defect_ridges.json → ZZX cube (ridges v1-ignored)", () => {
    const r = equisetaToBlocks(loadFixture("y_defect_ridges.json"));
    assertSuccess(r);
    expect(r.cubeType).toBe("ZZX");
    expect(r.blocks.size).toBe(1);
    expect(r.portCount).toBe(0);
  });

  it("all_open.json → single port marker at origin, no cube (special case)", () => {
    const r = equisetaToBlocks(loadFixture("all_open.json"));
    assertSuccess(r);
    expect(r.cubeType).toBeNull();
    expect(r.blocks.size).toBe(0);
    expect(r.portCount).toBe(1);
    expect(r.portPositions.has("0,0,0")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Expected rejections (bundled fixtures)
// ---------------------------------------------------------------------------

describe("equisetaToBlocks — bundled fixture rejections (D6, E2)", () => {
  it("all_red.json → unsupported-pattern XXX", () => {
    const r = equisetaToBlocks(loadFixture("all_red.json"));
    expect(r).toEqual({ ok: false, reason: "unsupported-pattern", pattern: "XXX" });
  });

  it("all_blue.json → unsupported-pattern ZZZ", () => {
    const r = equisetaToBlocks(loadFixture("all_blue.json"));
    expect(r).toEqual({ ok: false, reason: "unsupported-pattern", pattern: "ZZZ" });
  });

  it("hadamard_top.json → unsupported-pattern XXX (bottom face anchors X-basis on Z)", () => {
    const r = equisetaToBlocks(loadFixture("hadamard_top.json"));
    expect(r).toEqual({ ok: false, reason: "unsupported-pattern", pattern: "XXX" });
  });

  it("blue_pair_east_west.json (all-BLUE pair) → unsupported-pattern ZZZ on first cube", () => {
    // Same degenerate case as the legacy single-cube `all_blue.json`: each
    // cube in the pair resolves to ZZZ (not in CUBE_TYPES). Surfaces an
    // unsupported-pattern toast — same precedent as `all_red.json`/`all_blue.json`.
    const r = equisetaToBlocks(loadFixture("blue_pair_east_west.json"));
    expect(r).toEqual({ ok: false, reason: "unsupported-pattern", pattern: "ZZZ" });
  });

  it("red_pair_east_west.json (all-RED pair) → unsupported-pattern XXX on first cube", () => {
    const r = equisetaToBlocks(loadFixture("red_pair_east_west.json"));
    expect(r).toEqual({ ok: false, reason: "unsupported-pattern", pattern: "XXX" });
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Synthetic edge cases
// ---------------------------------------------------------------------------

describe("equisetaToBlocks — synthetic edge cases", () => {
  it("empty graph → D8 empty result (info toast path)", () => {
    const r = equisetaToBlocks({ nodes: [], edges: [] });
    expect(r).toEqual({ ok: true, empty: true });
  });

  it("1 node + 1 synthetic edge with dangling endpoint → edge-dangling", () => {
    const graph: FtqcGraph = {
      nodes: [
        buildNode({
          east: "open",
          west: "blue",
          north: "blue",
          south: "blue",
          top: "red",
          bottom: "red",
        }),
      ],
      edges: [
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
      ],
    };
    const r = equisetaToBlocks(graph);
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("edge-dangling");
    if (r.reason === "edge-dangling") {
      expect(r.endpoint).toEqual([1, 0, 0]);
    }
  });

  it("axis-pair color mismatch (east=red, west=blue) → axis-pair-mismatch on X", () => {
    const graph: FtqcGraph = {
      nodes: [buildNode({ east: "red", west: "blue" })],
      edges: [],
    };
    const r = equisetaToBlocks(graph);
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("axis-pair-mismatch");
    if (r.reason === "axis-pair-mismatch") {
      expect(r.axis).toBe("X");
      expect(r.first).toBe("red");
      expect(r.second).toBe("blue");
    }
  });

  it("malformed coordinate (non-integer) → malformed-coordinate", () => {
    // Build manually to bypass the schema validator (which would also catch this).
    const graph = {
      nodes: [{ ...buildNode({}), coordinate: [0.5, 0, 0] as [number, number, number] }],
      edges: [],
    } as FtqcGraph;
    const r = equisetaToBlocks(graph);
    expect(r).toEqual({ ok: false, reason: "malformed-coordinate" });
  });

  it("non-origin coordinate scales by 3 (i*3, j*3, k*3)", () => {
    const graph: FtqcGraph = {
      nodes: [
        buildNode(
          { east: "blue", west: "blue", north: "blue", south: "blue", top: "red", bottom: "red" },
          [1, -2, 3],
        ),
      ],
      edges: [],
    };
    const r = equisetaToBlocks(graph);
    assertSuccess(r);
    expect(r.cubeType).toBe("ZZX");
    expect(r.blocks.size).toBe(1);
    const block = [...r.blocks.values()][0];
    expect(block.pos).toEqual({ x: 3, y: -6, z: 9 });
  });

  it("port on east face → port marker at +X offset from cube", () => {
    const graph: FtqcGraph = {
      nodes: [
        buildNode({ east: "port", west: "red", north: "red", south: "red", top: "blue", bottom: "blue" }),
      ],
      edges: [],
    };
    const r = equisetaToBlocks(graph);
    assertSuccess(r);
    // east=port (no basis on east), west=red (X-basis): X-axis basis = X
    // Y-axis = X-basis (red/red), Z-axis = Z-basis (blue/blue) → XXZ
    expect(r.cubeType).toBe("XXZ");
    expect(r.portCount).toBe(1);
    expect(r.portPositions.has("1,0,0")).toBe(true);
  });

  it("all-port faces with no basis info → no-basis-info", () => {
    const graph: FtqcGraph = {
      nodes: [
        buildNode({
          east: "port",
          west: "port",
          north: "port",
          south: "port",
          top: "port",
          bottom: "port",
        }),
      ],
      edges: [],
    };
    const r = equisetaToBlocks(graph);
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("no-basis-info");
    if (r.reason === "no-basis-info") {
      expect(r.faces.east).toBe("port");
      expect(r.faces.top).toBe("port");
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Group invariants
// ---------------------------------------------------------------------------

describe("equisetaToBlocks — group + invariants", () => {
  it("D4: all emitted blocks share one groupId", () => {
    const r = equisetaToBlocks(loadFixture("port_io.json"));
    assertSuccess(r);
    const groupIds = [...r.blocks.values()].map((b) => b.groupId);
    expect(new Set(groupIds).size).toBe(1);
    expect(groupIds[0]).toBe(r.groupId);
  });

  it("groupId is 8 alphanumeric chars (lower-case)", () => {
    const r = equisetaToBlocks(loadFixture("zxx_memory.json"));
    assertSuccess(r);
    expect(r.groupId).toMatch(/^[0-9a-z]{8}$/);
  });

  it("two imports get distinct groupIds", () => {
    const r1 = equisetaToBlocks(loadFixture("zxx_memory.json"));
    const r2 = equisetaToBlocks(loadFixture("zxx_memory.json"));
    assertSuccess(r1);
    assertSuccess(r2);
    expect(r1.groupId).not.toBe(r2.groupId);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Toast summary helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Suite 6: Two-cube fixtures (v0.5)
// ---------------------------------------------------------------------------

describe("equisetaToBlocks — two-cube fixtures (v0.5)", () => {
  it("zxx_memory_pair.json → 2 ZZX cubes + 1 OZX pipe", () => {
    const r = equisetaToBlocks(loadFixture("zxx_memory_pair.json"));
    assertSuccess(r);
    expect(r.cubeCount).toBe(2);
    expect(r.pipeCount).toBe(1);
    expect(r.portCount).toBe(0);
    expect(r.hadamardCount).toBe(0);
    // 2 cubes + 1 pipe = 3 blocks
    expect(r.blocks.size).toBe(3);
    expect(r.blocks.get("0,0,0")?.type).toBe("ZZX");
    expect(r.blocks.get("3,0,0")?.type).toBe("ZZX");
    // Pipe between them at x=1.5 on X-axis
    const pipeBlocks = [...r.blocks.values()].filter((b) => b.type === "OZX");
    expect(pipeBlocks).toHaveLength(1);
  });

  it("xzz_memory_pair.json → 2 XXZ cubes + 1 pipe", () => {
    const r = equisetaToBlocks(loadFixture("xzz_memory_pair.json"));
    assertSuccess(r);
    expect(r.cubeCount).toBe(2);
    expect(r.pipeCount).toBe(1);
    expect(r.blocks.get("0,0,0")?.type).toBe("XXZ");
    expect(r.blocks.get("3,0,0")?.type).toBe("XXZ");
  });

  it("zxx_time_evolution.json → edge-no-pipe-type (ZZO not in PIPE_TYPES)", () => {
    // Two ZZX cubes stacked on K (time). Open axis Z; pipe would be "ZZO"
    // (cube perpendicular bases are Z,Z). piper-draw's PIPE_TYPES require
    // mixed perpendicular bases (one Z, one X) — same-basis pipes aren't
    // modeled in the surface-code semantics. Same root cause as blue_pair.
    const r = equisetaToBlocks(loadFixture("zxx_time_evolution.json"));
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("edge-no-pipe-type");
    if (r.reason === "edge-no-pipe-type") {
      expect(r.pattern).toBe("ZZO");
    }
  });

  it("port_io_pair.json → edge-no-pipe-type (ZZO not in PIPE_TYPES)", () => {
    // Same shape as zxx_time_evolution: ZZX cubes stacked on K with PORT
    // on outer faces. The seam pipe would still be ZZO — unrepresentable.
    // The OUTER port markers are correctly emitted on the non-seam Z faces;
    // the import fails on the pipe step.
    const r = equisetaToBlocks(loadFixture("port_io_pair.json"));
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("edge-no-pipe-type");
  });

  it("hadamard_pipe.json → ZZX + XXZ cubes joined by OZXH (bases flip across H)", () => {
    // A Hadamard pipe swaps X/Z bases along its axis, so the cubes on either
    // side carry opposite bases on the perpendicular faces. Upstream fixture
    // (equiseta f7a63ea): cube A is zxx_memory (ZZX), cube B is xzz_memory
    // (XXZ). Y axis flips Z↔X, Z axis flips X↔Z. Pipe code uses cube A's
    // bases (smaller-coord convention) → OZXH.
    const r = equisetaToBlocks(loadFixture("hadamard_pipe.json"));
    assertSuccess(r);
    expect(r.cubeCount).toBe(2);
    expect(r.pipeCount).toBe(1);
    expect(r.blocks.get("0,0,0")?.type).toBe("ZZX");
    expect(r.blocks.get("3,0,0")?.type).toBe("XXZ");
    const pipeBlocks = [...r.blocks.values()].filter((b) => b.type === "OZXH");
    expect(pipeBlocks).toHaveLength(1);
  });

  it("every successful two-cube fixture lands every block on a valid grid slot", () => {
    // Sweep across the 4 representable two-cube fixtures and confirm both
    // cubes (≡ 0 mod 3) and pipes (one axis ≡ 1 mod 3) are on slots the
    // renderer accepts.
    for (const name of [
      "zxx_memory_pair.json",
      "xzz_memory_pair.json",
      "hadamard_pipe.json",
      "disconnected_pair.json",
    ]) {
      const r = equisetaToBlocks(loadFixture(name));
      assertSuccess(r);
      for (const block of r.blocks.values()) {
        const validSlot = isPipeType(block.type)
          ? isValidPipePos(block.pos)
          : isValidBlockPos(block.pos);
        if (!validSlot) {
          throw new Error(
            `${name}: block at ${JSON.stringify(block.pos)} (type ${block.type}) is not on a valid grid slot`,
          );
        }
      }
    }
  });

  it("disconnected_pair.json → 2 cubes, 0 pipes, no satellites", () => {
    const r = equisetaToBlocks(loadFixture("disconnected_pair.json"));
    assertSuccess(r);
    expect(r.cubeCount).toBe(2);
    expect(r.pipeCount).toBe(0);
    expect(r.portCount).toBe(0);
    expect(r.hadamardCount).toBe(0);
    expect(r.blocks.size).toBe(2);
    expect(r.blocks.get("0,0,0")?.type).toBe("ZZX");
    expect(r.blocks.get("9,0,0")?.type).toBe("ZZX");
    // Two distinct groupIds (one per component).
    const groupIds = new Set([...r.blocks.values()].map((b) => b.groupId));
    expect(groupIds.size).toBe(2);
  });

  it("koval_q_couch_cnot.json → 10 cubes + 10 pipes + 4 ports + 1 slab (basis-hint propagation + 2×2 cluster)", () => {
    // The Koval-q couch CNOT has a Y-axis sandwich at (0,1,1) (both north and
    // south are open seams), so its Y basis is wildcard from face-color
    // resolution alone. The neighboring cube (1,1,1) has Y=X fixed by its
    // north=red face; without basis-hint propagation, (0,1,1) would canonicalize
    // to XZZ (Y=Z) and the X-axis pipe to (1,1,1) would fail with
    // edge-no-pipe-type (perpendicular Y bases mismatch). Propagation pulls
    // (0,1,1).Y = X from the X-axis neighbor, picking XXZ instead.
    //
    // The couch's bottom layer (JSON z=1) has cubes at (0,0,1), (1,0,1),
    // (0,1,1), (1,1,1) — a 2×2 XY cluster. The auto-slab rule fills the gap
    // with a slab at piper-draw (1, 1, 3) (toolbar shows 0.333, 0.333, 1).
    const r = equisetaToBlocks(loadFixture("koval_q_couch_cnot.json"));
    assertSuccess(r);
    expect(r.cubeCount).toBe(10);
    expect(r.pipeCount).toBe(10);
    expect(r.portCount).toBe(4);
    expect(r.slabCount).toBe(1);
    expect(r.blocks.size).toBe(21);
    const slab = r.blocks.get("1,1,3");
    expect(slab?.type).toBe("slab");
    expect(slab?.pos).toEqual({ x: 1, y: 1, z: 3 });
    // Slab joins the same connected component as the cubes it bridges.
    expect(slab?.groupId).toBe(r.groupId);
    // Every block on a valid grid slot.
    for (const block of r.blocks.values()) {
      const validSlot = isPipeType(block.type)
        ? isValidPipePos(block.pos)
        : isSlabType(block.type)
          ? isValidSlabPos(block.pos)
          : isValidBlockPos(block.pos);
      if (!validSlot) {
        throw new Error(
          `koval_q_couch_cnot: block at ${JSON.stringify(block.pos)} (type ${block.type}) is not on a valid grid slot`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 6.5: Auto-slab rule for XY 2×2 cube clusters
// ---------------------------------------------------------------------------

function openCubeNode(coord: [number, number, number]) {
  // Minimal valid cube: red x/z faces, open y faces. Sufficient for cluster
  // tests since we only care about block positions, not basis resolution.
  return buildNode(
    {
      east: "red",
      west: "red",
      north: "open",
      south: "open",
      top: "red",
      bottom: "red",
    },
    coord,
  );
}

describe("equisetaToBlocks — auto-slab rule for XY 2×2 cube clusters", () => {
  it("emits one slab at piper-draw (3i+1, 3j+1, 3k) for a single cluster at JSON (i,j,k)", () => {
    const graph: FtqcGraph = {
      nodes: [
        openCubeNode([5, 7, 2]),
        openCubeNode([6, 7, 2]),
        openCubeNode([5, 8, 2]),
        openCubeNode([6, 8, 2]),
      ],
      edges: [],
    };
    const r = equisetaToBlocks(graph);
    assertSuccess(r);
    expect(r.cubeCount).toBe(4);
    expect(r.slabCount).toBe(1);
    const slab = r.blocks.get("16,22,6");
    expect(slab?.type).toBe("slab");
    expect(slab?.pos).toEqual({ x: 16, y: 22, z: 6 });
    expect(isValidSlabPos(slab!.pos)).toBe(true);
    // Slab inherits the anchor node's groupId.
    const anchorCube = r.blocks.get("15,21,6");
    expect(slab?.groupId).toBe(anchorCube?.groupId);
  });

  it("emits no slab when no 2×2 cluster is present (disconnected_pair fixture)", () => {
    const r = equisetaToBlocks(loadFixture("disconnected_pair.json"));
    assertSuccess(r);
    expect(r.slabCount).toBe(0);
    for (const block of r.blocks.values()) {
      expect(isSlabType(block.type)).toBe(false);
    }
  });

  it("emits two slabs for overlapping clusters in a 2×3 XY block of cubes", () => {
    // Cubes at JSON (0..1, 0..2, 0) — six nodes, two 2×2 clusters sharing
    // the middle row (anchored at j=0 and j=1).
    const graph: FtqcGraph = {
      nodes: [
        openCubeNode([0, 0, 0]),
        openCubeNode([1, 0, 0]),
        openCubeNode([0, 1, 0]),
        openCubeNode([1, 1, 0]),
        openCubeNode([0, 2, 0]),
        openCubeNode([1, 2, 0]),
      ],
      edges: [],
    };
    const r = equisetaToBlocks(graph);
    assertSuccess(r);
    expect(r.cubeCount).toBe(6);
    expect(r.slabCount).toBe(2);
    expect(r.blocks.get("1,1,0")?.type).toBe("slab");
    expect(r.blocks.get("1,4,0")?.type).toBe("slab");
  });
});

// ---------------------------------------------------------------------------
// Suite 7: Edge-validation error paths
// ---------------------------------------------------------------------------

function blueWestOpenEastNode(coord: [number, number, number]) {
  return buildNode(
    {
      east: "open",
      west: "blue",
      north: "blue",
      south: "blue",
      top: "red",
      bottom: "red",
    },
    coord,
  );
}

function blueEastOpenWestNode(coord: [number, number, number]) {
  return buildNode(
    {
      east: "blue",
      west: "open",
      north: "blue",
      south: "blue",
      top: "red",
      bottom: "red",
    },
    coord,
  );
}

describe("equisetaToBlocks — edge validation errors", () => {
  it("edge with non-adjacent endpoints (>1 step apart) → edge-non-adjacent", () => {
    const graph: FtqcGraph = {
      nodes: [blueWestOpenEastNode([0, 0, 0]), blueEastOpenWestNode([2, 0, 0])],
      edges: [[[0, 0, 0], [2, 0, 0]]],
    };
    const r = equisetaToBlocks(graph);
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("edge-non-adjacent");
  });

  it("edge differing on 2 axes → edge-non-adjacent", () => {
    const graph: FtqcGraph = {
      nodes: [blueWestOpenEastNode([0, 0, 0]), blueEastOpenWestNode([1, 1, 0])],
      edges: [[[0, 0, 0], [1, 1, 0]]],
    };
    const r = equisetaToBlocks(graph);
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("edge-non-adjacent");
  });

  it("edge with endpoint not in nodes[] → edge-dangling", () => {
    const graph: FtqcGraph = {
      nodes: [blueWestOpenEastNode([0, 0, 0])],
      edges: [[[0, 0, 0], [1, 0, 0]]],
    };
    const r = equisetaToBlocks(graph);
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("edge-dangling");
    if (r.reason === "edge-dangling") {
      expect(r.endpoint).toEqual([1, 0, 0]);
    }
  });

  it("self-loop edge → edge-self-loop", () => {
    const graph: FtqcGraph = {
      nodes: [blueWestOpenEastNode([0, 0, 0])],
      edges: [[[0, 0, 0], [0, 0, 0]]],
    };
    const r = equisetaToBlocks(graph);
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("edge-self-loop");
  });

  it("duplicate edge (order-invariant) → edge-duplicate", () => {
    const graph: FtqcGraph = {
      nodes: [blueWestOpenEastNode([0, 0, 0]), blueEastOpenWestNode([1, 0, 0])],
      edges: [
        [[0, 0, 0], [1, 0, 0]],
        [[1, 0, 0], [0, 0, 0]],
      ],
    };
    const r = equisetaToBlocks(graph);
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("edge-duplicate");
  });

  it("seam faces incompatible (open + blue) → edge-seam-incompatible", () => {
    const graph: FtqcGraph = {
      nodes: [
        blueWestOpenEastNode([0, 0, 0]), // east = open
        buildNode(
          // west = blue (not open), east = blue
          { east: "blue", west: "blue", north: "blue", south: "blue", top: "red", bottom: "red" },
          [1, 0, 0],
        ),
      ],
      edges: [[[0, 0, 0], [1, 0, 0]]],
    };
    const r = equisetaToBlocks(graph);
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("edge-seam-incompatible");
    if (r.reason === "edge-seam-incompatible") {
      expect(r.facing.a).toBe("open");
      expect(r.facing.b).toBe("blue");
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 8: Axis-permutation table + edge-order invariance
// ---------------------------------------------------------------------------

describe("equisetaToBlocks — axis-permutation table", () => {
  // For each axis and each direction, construct an open-face pair of cubes
  // and verify the resulting pipe sits at the expected midpoint. Run with
  // both edge orderings to confirm invariance.
  type AxisCase = {
    name: string;
    coordA: [number, number, number];
    coordB: [number, number, number];
    seamFaceA: "east" | "west" | "north" | "south" | "top" | "bottom";
    seamFaceB: "east" | "west" | "north" | "south" | "top" | "bottom";
    expectedPipePos: { x: number; y: number; z: number };
  };

  const baseFaces = {
    east: "blue", west: "blue", north: "blue", south: "blue", top: "red", bottom: "red",
  };

  const cases: AxisCase[] = [
    {
      name: "X-axis (+i)",
      coordA: [0, 0, 0], coordB: [1, 0, 0],
      seamFaceA: "east", seamFaceB: "west",
      expectedPipePos: { x: 1, y: 0, z: 0 },
    },
    {
      name: "Y-axis (+j)",
      coordA: [0, 0, 0], coordB: [0, 1, 0],
      seamFaceA: "north", seamFaceB: "south",
      expectedPipePos: { x: 0, y: 1, z: 0 },
    },
  ];

  for (const c of cases) {
    for (const [labelOrder, edge] of [
      ["forward", [c.coordA, c.coordB]] as const,
      ["reversed", [c.coordB, c.coordA]] as const,
    ]) {
      it(`${c.name} ${labelOrder} → pipe at expected midpoint`, () => {
        const facesA = { ...baseFaces, [c.seamFaceA]: "open" } as Record<string, FaceColor>;
        const facesB = { ...baseFaces, [c.seamFaceB]: "open" } as Record<string, FaceColor>;
        const graph: FtqcGraph = {
          nodes: [buildNode(facesA, c.coordA), buildNode(facesB, c.coordB)],
          edges: [edge as unknown as FtqcGraph["edges"][number]],
        };
        const r = equisetaToBlocks(graph);
        assertSuccess(r);
        expect(r.cubeCount).toBe(2);
        expect(r.pipeCount).toBe(1);
        const pipeBlock = [...r.blocks.values()].find(
          (b) => b.pos.x === c.expectedPipePos.x && b.pos.y === c.expectedPipePos.y && b.pos.z === c.expectedPipePos.z,
        );
        expect(pipeBlock).toBeTruthy();
        // Guard: pipe must sit on a renderable pipe slot. Catches fractional
        // / off-grid positions that would silently fail rendering.
        if (pipeBlock) expect(isValidPipePos(pipeBlock.pos)).toBe(true);
      });
    }
  }
});

describe("summarizeSuccess / summarizeError", () => {
  it("success toast: cube + 2 ports + filename", () => {
    const r = equisetaToBlocks(loadFixture("port_io.json"));
    assertSuccess(r);
    expect(summarizeSuccess(r, "port_io.json")).toBe(
      "Imported XXZ cube + 2 ports from port_io.json",
    );
  });

  it("success toast: cube only, no filename", () => {
    const r = equisetaToBlocks(loadFixture("zxx_memory.json"));
    assertSuccess(r);
    expect(summarizeSuccess(r)).toBe("Imported ZZX cube");
  });

  it("success toast: all-open special case", () => {
    const r = equisetaToBlocks(loadFixture("all_open.json"));
    assertSuccess(r);
    expect(summarizeSuccess(r, "all_open.json")).toBe(
      "Imported 1 port marker (all-open) from all_open.json",
    );
  });

  it("success toast: Koval-q couch mentions the auto-slab", () => {
    const r = equisetaToBlocks(loadFixture("koval_q_couch_cnot.json"));
    assertSuccess(r);
    expect(summarizeSuccess(r, "koval_q_couch_cnot.json")).toBe(
      "Imported 10 cubes + 10 pipes + 4 ports + 1 slab from koval_q_couch_cnot.json",
    );
  });

  it("error toast: no-basis-info", () => {
    expect(
      summarizeError({
        ok: false,
        reason: "no-basis-info",
        faces: {
          east: "port",
          west: "port",
          north: "port",
          south: "port",
          top: "port",
          bottom: "port",
        },
      }),
    ).toBe(
      "No basis info on any face — every face is port/hadamard/null. Add at least one red or blue face to anchor the cube type.",
    );
  });

  it("error toast: unsupported-pattern XXX", () => {
    expect(
      summarizeError({ ok: false, reason: "unsupported-pattern", pattern: "XXX" }),
    ).toBe(
      "No piper-draw cube type for face pattern XXX. Equiseta accepts this; piper-draw doesn't yet.",
    );
  });

  it("error toast: axis-pair-mismatch", () => {
    expect(
      summarizeError({
        ok: false,
        reason: "axis-pair-mismatch",
        axis: "X",
        first: "red",
        second: "blue",
      }),
    ).toBe("Inconsistent face colors on X-axis (got red and blue)");
  });

  it("error toast: malformed-coordinate", () => {
    expect(summarizeError({ ok: false, reason: "malformed-coordinate" })).toBe(
      "Invalid coordinate in nodes[0] — expected [int, int, int]",
    );
  });
});
