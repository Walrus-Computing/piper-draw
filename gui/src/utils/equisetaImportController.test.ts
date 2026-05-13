import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runEquisetaImport } from "./equisetaImportController";
import { parseFtqcGraph, type FtqcGraph, type RidgeId } from "./equisetaJsonSchema";
import { useBlockStore } from "../stores/blockStore";
import { useValidationStore } from "../stores/validationStore";

// Mock the network-bound validate so we don't actually hit /api/validate.
vi.mock("./validate", () => ({
  validateDiagram: vi.fn(),
}));
import { validateDiagram } from "./validate";
const mockValidate = vi.mocked(validateDiagram);

const FIXTURES_DIR = join(process.cwd(), "public", "equiseta-examples");

function loadFixture(name: string): FtqcGraph {
  const text = readFileSync(join(FIXTURES_DIR, name), "utf8");
  const r = parseFtqcGraph(JSON.parse(text));
  if (!r.ok) throw new Error(`fixture ${name} failed schema parse: ${r.path}`);
  return r.value;
}

function resetStores() {
  useBlockStore.setState({
    blocks: new Map(),
    portMeta: new Map(),
    portPositions: new Set(),
    history: [],
    future: [],
    freeBuild: false,
  });
  useValidationStore.setState({
    status: "idle",
    errors: [],
    invalidKeys: new Set(),
    selectedErrorKey: null,
  });
}

describe("runEquisetaImport — replace mode", () => {
  beforeEach(() => {
    resetStores();
    mockValidate.mockReset();
    mockValidate.mockResolvedValue({ valid: true, errors: [] });
  });

  it("B1: loads blocks into blockStore via loadBlocks", () => {
    // zxx_memory imports as a valid single cube.
    const graph = loadFixture("zxx_memory.json");
    runEquisetaImport(graph, "zxx memory", "replace");
    expect(useBlockStore.getState().blocks.size).toBe(1);
  });

  it("B2: triggers validate() exactly once on successful replace", () => {
    const graph = loadFixture("zxx_memory.json");
    runEquisetaImport(graph, "zxx memory", "replace");
    // mockValidate is called via useValidationStore.getState().validate() →
    // validateDiagram(blocks). The validate() action is fire-and-forget, but
    // it kicks off synchronously and bumps status to "loading" before await.
    expect(mockValidate).toHaveBeenCalledTimes(1);
    expect(useValidationStore.getState().status).toBe("loading");
  });

  it("B4: structural error path — no loadBlocks, no validate", () => {
    // Synthetic no-basis-info graph: every face is hadamard so the translator
    // can't anchor any cube basis. Confirms structural-error branch still
    // skips loadBlocks + validate. (`all_blue.json` used to live here but is
    // now handled by the freeBuildOnly fallback path — see autoplan
    // 2026-05-12 / Approach B.)
    const RIDGE_KEYS: RidgeId[] = [
      "I_BOT_SOUTH", "I_BOT_NORTH", "I_TOP_SOUTH", "I_TOP_NORTH",
      "J_BOT_WEST", "J_BOT_EAST", "J_TOP_WEST", "J_TOP_EAST",
      "K_SOUTH_WEST", "K_SOUTH_EAST", "K_NORTH_WEST", "K_NORTH_EAST",
    ];
    const ridges = {} as Record<RidgeId, boolean | null>;
    for (const k of RIDGE_KEYS) ridges[k] = null;
    const graph: FtqcGraph = {
      nodes: [{
        coordinate: [0, 0, 0],
        faces: {
          east: "hadamard",
          west: "hadamard",
          north: "hadamard",
          south: "hadamard",
          top: "hadamard",
          bottom: "hadamard",
        },
        ridges,
      }],
      edges: [],
    };
    runEquisetaImport(graph, "all-hadamard synthetic", "replace");
    expect(useBlockStore.getState().blocks.size).toBe(0);
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it("B5: all_blue.json (view-only path) → loadBlocks runs + validate triggers", () => {
    // After autoplan 2026-05-12 (Approach B): all_blue produces a fallback
    // XZZ cube with freeBuildOnly set, so the v0.6.1.0 auto-validate path
    // engages and the toast surfaces "Enable Free Build" as designed.
    const graph = loadFixture("all_blue.json");
    runEquisetaImport(graph, "all blue", "replace");
    const block = Array.from(useBlockStore.getState().blocks.values())[0];
    expect(block).toBeDefined();
    expect(block.type).toBe("XZZ");
    expect(block.freeBuildOnly?.displayPattern).toBe("ZZZ");
    expect(mockValidate).toHaveBeenCalledTimes(1);
  });
});

describe("runEquisetaImport — append mode", () => {
  beforeEach(() => {
    resetStores();
    mockValidate.mockReset();
    mockValidate.mockResolvedValue({ valid: true, errors: [] });
  });

  it("B3: does NOT trigger validate() in append mode", () => {
    const graph = loadFixture("zxx_memory.json");
    runEquisetaImport(graph, "zxx memory", "append");
    expect(mockValidate).not.toHaveBeenCalled();
  });
});

describe("runEquisetaImport — concurrent validation correctness", () => {
  beforeEach(() => {
    resetStores();
    mockValidate.mockReset();
  });

  it("fires validate even when status is already 'loading', so requestVersion bumps and the latest wins", () => {
    // Codex finding: a previous "skip if status === loading" guard caused
    // a stale validation result to apply to the wrong scene when a fast
    // import B landed while A's validate fetch was still in flight.
    // The right behavior is to always fire; requestVersion (validationStore.ts:35)
    // discards earlier results when a later validate bumps the counter.
    useValidationStore.setState({ status: "loading" });
    mockValidate.mockResolvedValue({ valid: true, errors: [] });

    const graph = loadFixture("zxx_memory.json");
    runEquisetaImport(graph, "zxx memory", "replace");

    expect(mockValidate).toHaveBeenCalledTimes(1);
  });
});
