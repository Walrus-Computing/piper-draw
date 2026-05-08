import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFtqcGraph } from "./equisetaJsonSchema";

const FIXTURES_DIR = join(process.cwd(), "public", "equiseta-examples");

const FIXTURE_NAMES = [
  "all_open.json",
  "all_red.json",
  "all_blue.json",
  "zxx_memory.json",
  "xzz_memory.json",
  "hadamard_top.json",
  "port_io.json",
  "y_defect_ridges.json",
  "two_cubes.json",
];

describe("parseFtqcGraph (happy path: 9 bundled fixtures)", () => {
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

  it("the bundled fixtures dir contains exactly the 9 expected files plus manifest.json + README.md", () => {
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
