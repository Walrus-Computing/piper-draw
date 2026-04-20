import { afterEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../types";
import { validateDiagram } from "./validate";

function blocks(entries: Array<[string, Block]>): Map<string, Block> {
  return new Map(entries);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateDiagram", () => {
  it("sends each block as {pos, type} and returns the parsed server response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ valid: true, errors: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const input = blocks([
      ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
      ["3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "ZXZ" }],
    ]);
    const result = await validateDiagram(input);

    expect(result).toEqual({ valid: true, errors: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("/api/validate");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      blocks: [
        { pos: [0, 0, 0], type: "XZZ" },
        { pos: [3, 0, 0], type: "ZXZ" },
      ],
    });
  });

  it("returns a synthetic invalid result when the server responds non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })));

    const result = await validateDiagram(blocks([]));
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].position).toBe(null);
    expect(result.errors[0].message).toContain("500");
  });

  it("returns a friendly error when the fetch itself throws (server unreachable)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    const result = await validateDiagram(blocks([]));
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].position).toBe(null);
    expect(result.errors[0].message).toMatch(/not available/i);
  });

  it("serializes an empty block map as an empty array", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ valid: true, errors: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await validateDiagram(blocks([]));
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toEqual({ blocks: [] });
  });
});
