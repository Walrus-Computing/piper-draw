import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateDiagram } from "./validate";
import type { Block, FreeBuildPipeSpec } from "../types";

const FB_SPEC: FreeBuildPipeSpec = {
  kind: "fb-pipe",
  openAxis: 2,
  defectPositions: [0.5],
  faces: ["XZ", "XZ", "XZ", "XZ"],
};

describe("validateDiagram", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, errors: [] }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips free-build blocks from the request payload (defense-in-depth)", async () => {
    const blocks = new Map<string, Block>();
    blocks.set("0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" as Block["type"] });
    blocks.set("0,0,1", { pos: { x: 0, y: 0, z: 1 }, type: FB_SPEC });
    blocks.set("0,0,3", { pos: { x: 0, y: 0, z: 3 }, type: "ZXZ" as Block["type"] });

    await validateDiagram(blocks);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { blocks: Array<{ pos: number[]; type: string }> };
    // Only the two TQEC cubes should be in the payload.
    expect(body.blocks).toHaveLength(2);
    const types = body.blocks.map((b) => b.type).sort();
    expect(types).toEqual(["XZZ", "ZXZ"]);
    // No `[object Object]` artifact — FB pipes should never be stringified
    // into the request body.
    expect(init.body).not.toContain("object Object");
  });

  it("passes through TQEC-only scenes unchanged", async () => {
    const blocks = new Map<string, Block>();
    blocks.set("0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" as Block["type"] });
    blocks.set("0,0,3", { pos: { x: 0, y: 0, z: 3 }, type: "ZXZ" as Block["type"] });

    await validateDiagram(blocks);

    const call = fetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { blocks: unknown[] };
    expect(body.blocks).toHaveLength(2);
  });
});
