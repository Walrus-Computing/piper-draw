import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canonicalizeEquisetaJson, parseFtqcGraph } from "./equisetaJsonSchema";

const FIXTURES_DIR = join(process.cwd(), "public", "equiseta-examples");

const SINGLE_CUBE_FIXTURES = [
  "all_open.json",
  "all_red.json",
  "all_blue.json",
  "zxx_memory.json",
  "xzz_memory.json",
  "hadamard_top.json",
  "port_io.json",
  "y_defect_ridges.json",
];

const TWO_CUBE_FIXTURES = [
  "blue_pair_east_west.json",
  "red_pair_east_west.json",
  "zxx_memory_pair.json",
  "xzz_memory_pair.json",
  "zxx_time_evolution.json",
  "hadamard_pipe.json",
  "port_io_pair.json",
  "disconnected_pair.json",
];

const FIXTURE_NAMES = [...SINGLE_CUBE_FIXTURES, ...TWO_CUBE_FIXTURES];

describe("parseFtqcGraph (happy path: bundled fixtures)", () => {
  for (const name of FIXTURE_NAMES) {
    it(`accepts ${name}`, () => {
      const text = readFileSync(join(FIXTURES_DIR, name), "utf8");
      const value: unknown = JSON.parse(text);
      const result = parseFtqcGraph(value);
      if (!result.ok) {
        throw new Error(`${name} failed: ${result.path} expected ${result.expected} got ${result.got}`);
      }
      expect(result.ok).toBe(true);
    });
  }

  it("the bundled fixtures dir contains exactly the expected files plus manifest.json + README.md", () => {
    const all = readdirSync(FIXTURES_DIR).sort();
    expect(all).toEqual(
      [...FIXTURE_NAMES, "README.md", "manifest.json"].sort(),
    );
  });
});

describe("parseFtqcGraph (malformed inputs)", () => {
  it("rejects non-object root", () => {
    const r = parseFtqcGraph(42);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.path).toBe("$");
      expect(r.expected).toBe("object");
      expect(r.got).toContain("42");
    }
  });

  it("rejects null root", () => {
    const r = parseFtqcGraph(null);
    expect(r).toEqual({ ok: false, path: "$", expected: "object", got: "null" });
  });

  it("rejects array root", () => {
    const r = parseFtqcGraph([]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.path).toBe("$");
      expect(r.expected).toBe("object");
      expect(r.got).toContain("array");
    }
  });

  it("rejects missing top-level key", () => {
    const r = parseFtqcGraph({ nodes: [] });
    expect(r).toEqual({ ok: false, path: "$.edges", expected: "present", got: "string(\"missing\")" });
  });

  it("rejects extra top-level key", () => {
    const r = parseFtqcGraph({ nodes: [], edges: [], extra: 1 });
    expect(r).toEqual({ ok: false, path: "$.extra", expected: "absent", got: "string(\"extra key\")" });
  });

  it("rejects coordinate of wrong arity", () => {
    const r = parseFtqcGraph({
      nodes: [{ coordinate: [0, 0], faces: stubFaces(), ridges: stubRidges() }],
      edges: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.path).toBe("$.nodes[0].coordinate");
      expect(r.expected).toBe("array of length 3");
    }
  });

  it("rejects non-integer coordinate component", () => {
    const r = parseFtqcGraph({
      nodes: [{ coordinate: [0, 0.5, 0], faces: stubFaces(), ridges: stubRidges() }],
      edges: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.path).toBe("$.nodes[0].coordinate[1]");
      expect(r.expected).toBe("integer");
    }
  });

  it("rejects unknown direction key on faces", () => {
    const faces = { ...stubFaces() } as Record<string, string>;
    delete faces.top;
    faces.up = "red"; // wrong direction name
    const r = parseFtqcGraph({
      nodes: [{ coordinate: [0, 0, 0], faces, ridges: stubRidges() }],
      edges: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.path).toBe("$.nodes[0].faces.up");
      expect(r.expected).toContain("top|bottom");
    }
  });

  it("rejects unknown FaceColor enum value", () => {
    const faces = { ...stubFaces() } as Record<string, string>;
    faces.top = "orange";
    const r = parseFtqcGraph({
      nodes: [{ coordinate: [0, 0, 0], faces, ridges: stubRidges() }],
      edges: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.path).toBe("$.nodes[0].faces.top");
      expect(r.expected).toContain("red|blue|open|hadamard|port|null");
    }
  });

  it("rejects malformed edge tuple", () => {
    const r = parseFtqcGraph({
      nodes: [],
      edges: [[[0, 0, 0], "not a coord"]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.path).toBe("$.edges[0][1]");
      expect(r.expected).toContain("integers");
    }
  });

  it("rejects ridge value of wrong type", () => {
    const ridges = { ...stubRidges() } as Record<string, unknown>;
    ridges.K_SOUTH_WEST = "yes"; // strings not allowed; only true/false/null
    const r = parseFtqcGraph({
      nodes: [{ coordinate: [0, 0, 0], faces: stubFaces(), ridges }],
      edges: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.path).toBe("$.nodes[0].ridges.K_SOUTH_WEST");
      expect(r.expected).toBe("true | false | null");
    }
  });
});

describe("canonicalizeEquisetaJson + upstream-format acceptance", () => {
  it("drops the top-level `version` field", () => {
    const r = canonicalizeEquisetaJson({ version: "0.0.0", nodes: [], edges: [] });
    expect(r).toEqual({ nodes: [], edges: [] });
  });

  it("lowercases UPPERCASE face direction keys per node", () => {
    const upper = {
      nodes: [
        {
          coordinate: [0, 0, 0],
          faces: {
            TOP: "red", BOTTOM: "red", NORTH: "red",
            SOUTH: "red", EAST: "red", WEST: "red",
          },
          ridges: stubRidges(),
        },
      ],
      edges: [],
    };
    const r = canonicalizeEquisetaJson(upper) as {
      nodes: { faces: Record<string, string> }[];
    };
    expect(Object.keys(r.nodes[0].faces).sort()).toEqual(
      ["bottom", "east", "north", "south", "top", "west"],
    );
  });

  it("is idempotent — running twice yields the same value", () => {
    const once = canonicalizeEquisetaJson({ version: "1", nodes: [], edges: [] });
    const twice = canonicalizeEquisetaJson(once);
    expect(twice).toEqual(once);
  });

  it("parseFtqcGraph accepts raw upstream-style JSON (UPPERCASE + version)", () => {
    const raw = {
      version: "0.0.0",
      nodes: [
        {
          coordinate: [0, 0, 0],
          faces: {
            BOTTOM: "blue", EAST: "open", NORTH: "blue",
            SOUTH: "blue", TOP: "blue", WEST: "blue",
          },
          ridges: stubRidges(),
        },
      ],
      edges: [],
    };
    const r = parseFtqcGraph(raw);
    if (!r.ok) {
      throw new Error(`expected ok, got ${r.path} ${r.expected} ${r.got}`);
    }
    expect(r.value.nodes[0].faces.bottom).toBe("blue");
    expect(r.value.nodes[0].faces.east).toBe("open");
  });
});

// Helpers — produce minimal valid faces/ridges objects so each test only
// has to mutate the field it's exercising.
function stubFaces() {
  return {
    top: "red", bottom: "red", north: "red",
    south: "red", east: "red", west: "red",
  };
}

function stubRidges() {
  return {
    I_BOT_SOUTH: null, I_BOT_NORTH: null, I_TOP_SOUTH: null, I_TOP_NORTH: null,
    J_BOT_WEST: null, J_BOT_EAST: null, J_TOP_WEST: null, J_TOP_EAST: null,
    K_SOUTH_WEST: null, K_SOUTH_EAST: null, K_NORTH_WEST: null, K_NORTH_EAST: null,
  };
}
