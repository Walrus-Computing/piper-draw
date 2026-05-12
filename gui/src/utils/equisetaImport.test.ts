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

  it("two_cubes.json → multi-node rejection (D6)", () => {
    const r = equisetaToBlocks(loadFixture("two_cubes.json"));
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("multi-node");
    if (r.reason === "multi-node") {
      expect(r.nodes).toBe(2);
      expect(r.edges).toBe(1);
    }
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

  it("1 node + 1 synthetic edge → multi-node rejection", () => {
    const graph: FtqcGraph = {
      nodes: [buildNode({})],
      edges: [
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
      ],
    };
    const r = equisetaToBlocks(graph);
    if (r.ok) throw new Error("expected reject");
    expect(r.reason).toBe("multi-node");
    if (r.reason === "multi-node") {
      expect(r.nodes).toBe(1);
      expect(r.edges).toBe(1);
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

  it("error toast: multi-node (pluralizes correctly)", () => {
    expect(
      summarizeError({ ok: false, reason: "multi-node", nodes: 2, edges: 1 }),
    ).toBe("Multi-node Equiseta import not yet supported (got 2 nodes, 1 edge)");
    expect(
      summarizeError({ ok: false, reason: "multi-node", nodes: 1, edges: 0 }),
    ).toBe("Multi-node Equiseta import not yet supported (got 1 node, 0 edges)");
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
