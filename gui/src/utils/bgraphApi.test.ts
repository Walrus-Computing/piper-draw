// Mock-fetch tests for bgraphApi.ts. Verifies happy paths and that every
// named error code in BgraphErrorCode surfaces correctly as a BgraphApiError
// with the right .status and .code attached.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BgraphApiError } from "../types/bgraph";
import { exportBgraph, importBgraph } from "./bgraphApi";

function mockFetchOk<T>(body: T): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);
}

function mockFetchError(status: number, detail: { code: string; message: string }): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ detail }),
  } as Response);
}

function mockFetchNetworkError(): void {
  vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
}

describe("exportBgraph", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts blocks + port labels and returns the bgraph string", async () => {
    mockFetchOk({ bgraph: "BLOCKGRAPH 0.1.0;\n...\n" });
    const result = await exportBgraph({
      blocks: new Map([
        ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "ZXZ" }],
      ]),
      portLabels: [],
    });
    expect(result.bgraph).toContain("BLOCKGRAPH 0.1.0;");
    expect(fetch).toHaveBeenCalledWith(
      "/api/bgraph_export",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws BgraphApiError with code on empty-scene rejection", async () => {
    mockFetchError(400, { code: "bgraph_empty", message: "Scene is empty; nothing to export." });
    await expect(
      exportBgraph({ blocks: new Map(), portLabels: [] }),
    ).rejects.toMatchObject({
      status: 400,
      code: "bgraph_empty",
    });
  });

  it("throws BgraphApiError with code on dup port label", async () => {
    mockFetchError(400, { code: "bgraph_dup_port_label", message: "Duplicate port label 'x'." });
    await expect(
      exportBgraph({
        blocks: new Map([["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "ZXZ" }]]),
        portLabels: [],
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "bgraph_dup_port_label",
    });
  });

  it("throws BgraphApiError on missing port label", async () => {
    mockFetchError(400, { code: "bgraph_missing_port_label", message: "Port at ... has no label." });
    await expect(
      exportBgraph({
        blocks: new Map([["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "ZXZ" }]]),
        portLabels: [],
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "bgraph_missing_port_label",
    });
  });

  it("throws BgraphApiError on network failure", async () => {
    mockFetchNetworkError();
    const err = await exportBgraph({ blocks: new Map(), portLabels: [] })
      .then(() => null)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BgraphApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBeNull();
  });
});

describe("importBgraph", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns blocks + port_labels on success", async () => {
    mockFetchOk({
      blocks: [
        { pos: [0, 0, 0], type: "ZXZ" },
        { pos: [1, 0, 0], type: "OZX" },
      ],
      port_labels: [{ pos: [3, 0, 0], label: "out_0" }],
      mode: "load",
    });
    const result = await importBgraph({ bgraph: "BLOCKGRAPH 0.1.0;..." });
    expect(result.blocks).toHaveLength(2);
    expect(result.port_labels).toHaveLength(1);
    expect(result.port_labels[0].label).toBe("out_0");
    expect(result.mode).toBe("load");
  });

  it("defaults mode to load when omitted in args", async () => {
    let captured: RequestInit | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ blocks: [], port_labels: [], mode: "load" }),
      } as Response;
    });
    await importBgraph({ bgraph: "BLOCKGRAPH 0.1.0;..." });
    const body = JSON.parse(captured!.body as string);
    expect(body.mode).toBe("load");
  });

  it("passes mode=insert when requested", async () => {
    let captured: RequestInit | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ blocks: [], port_labels: [], mode: "insert" }),
      } as Response;
    });
    await importBgraph({ bgraph: "BLOCKGRAPH 0.1.0;...", mode: "insert" });
    const body = JSON.parse(captured!.body as string);
    expect(body.mode).toBe("insert");
  });

  it("throws on bgraph_parse_error", async () => {
    mockFetchError(400, { code: "bgraph_parse_error", message: "Couldn't parse bgraph: ..." });
    await expect(
      importBgraph({ bgraph: "garbage" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "bgraph_parse_error",
    });
  });

  it("throws on bgraph_empty", async () => {
    mockFetchError(400, { code: "bgraph_empty", message: "Bgraph contains no cubes; import rejected." });
    await expect(
      importBgraph({ bgraph: "BLOCKGRAPH 0.1.0;\n" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "bgraph_empty",
    });
  });

  it("throws on size cap (413)", async () => {
    mockFetchError(413, { code: "bgraph_too_large", message: "Bgraph exceeds 5 MB cap." });
    await expect(
      importBgraph({ bgraph: "x".repeat(6 * 1024 * 1024) }),
    ).rejects.toMatchObject({
      status: 413,
      code: "bgraph_too_large",
    });
  });

  it("throws on dup port label", async () => {
    mockFetchError(400, { code: "bgraph_dup_port_label", message: "Duplicate port label 'x' in bgraph." });
    await expect(
      importBgraph({ bgraph: "BLOCKGRAPH 0.1.0;..." }),
    ).rejects.toMatchObject({
      status: 400,
      code: "bgraph_dup_port_label",
    });
  });

  it("throws BgraphApiError on network failure", async () => {
    mockFetchNetworkError();
    const err = await importBgraph({ bgraph: "any" })
      .then(() => null)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BgraphApiError);
    expect(err.status).toBe(0);
  });
});
