import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runEquisetaImport } from "./equisetaImportController";
import { parseFtqcGraph, type FtqcGraph } from "./equisetaJsonSchema";
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
    // zxx_memory imports as a valid single cube — used here because
    // all_blue.json is rejected by the importer (unsupported-pattern ZZZ)
    // before loadBlocks ever runs.
    const graph = loadFixture("zxx_memory.json");
    runEquisetaImport(graph, "zxx memory", "replace");
    expect(useBlockStore.getState().blocks.size).toBe(1);
  });

  it("B2: triggers validate() exactly once on successful replace", () => {
    // zxx_memory imports as a valid single cube — used here because
    // all_blue.json is rejected by the importer (unsupported-pattern ZZZ)
    // before loadBlocks ever runs.
    const graph = loadFixture("zxx_memory.json");
    runEquisetaImport(graph, "zxx memory", "replace");
    // mockValidate is called via useValidationStore.getState().validate() →
    // validateDiagram(blocks). The validate() action is fire-and-forget, but
    // it kicks off synchronously and bumps status to "loading" before await.
    expect(mockValidate).toHaveBeenCalledTimes(1);
    // Status was set to "loading" inside validate() before the await.
    expect(useValidationStore.getState().status).toBe("loading");
  });

  it("B4: structural error path — no loadBlocks, no validate", () => {
    // all_blue.json is rejected by the importer (unsupported pattern ZZZ).
    // Confirms the structural-error branch never reaches loadBlocks or validate.
    const graph = loadFixture("all_blue.json");
    runEquisetaImport(graph, "all blue", "replace");
    expect(useBlockStore.getState().blocks.size).toBe(0);
    expect(mockValidate).not.toHaveBeenCalled();
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
