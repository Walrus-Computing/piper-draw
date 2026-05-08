import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  parseEquisetaText,
  buildExampleUrl,
  buildManifestUrl,
  fetchEquisetaExample,
  fetchEquisetaManifest,
  getDroppedJsonText,
  MAX_BYTES,
} from "./equisetaJsonLoad";

// ---------------------------------------------------------------------
// parseEquisetaText
// ---------------------------------------------------------------------

describe("parseEquisetaText", () => {
  it("returns ok=true on valid JSON + valid schema", () => {
    const text = JSON.stringify({
      nodes: [
        {
          coordinate: [0, 0, 0],
          faces: { top: "red", bottom: "red", north: "red", south: "red", east: "red", west: "red" },
          ridges: {
            I_BOT_SOUTH: null, I_BOT_NORTH: null, I_TOP_SOUTH: null, I_TOP_NORTH: null,
            J_BOT_WEST: null, J_BOT_EAST: null, J_TOP_WEST: null, J_TOP_EAST: null,
            K_SOUTH_WEST: null, K_SOUTH_EAST: null, K_NORTH_WEST: null, K_NORTH_EAST: null,
          },
        },
      ],
      edges: [],
    });
    const r = parseEquisetaText(text);
    expect(r.ok).toBe(true);
  });

  it("returns invalid-json reason on bad JSON", () => {
    const r = parseEquisetaText("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "invalid-json") {
      expect(r.message.length).toBeGreaterThan(0);
    } else {
      throw new Error("expected invalid-json reason");
    }
  });

  it("returns schema-mismatch reason with path on schema error", () => {
    const r = parseEquisetaText('{"nodes": "not an array", "edges": []}');
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "schema-mismatch") {
      expect(r.path).toBe("$.nodes");
      expect(r.expected).toBe("array");
    } else {
      throw new Error("expected schema-mismatch reason");
    }
  });
});

// ---------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------

describe("buildExampleUrl / buildManifestUrl", () => {
  it("uses root base by default", () => {
    expect(buildExampleUrl("foo.json", "/")).toBe("/equiseta-examples/foo.json");
    expect(buildManifestUrl("/")).toBe("/equiseta-examples/manifest.json");
  });

  it("respects non-root BASE_URL (Fly subpath / GitHub Pages style)", () => {
    expect(buildExampleUrl("foo.json", "/piper/")).toBe("/piper/equiseta-examples/foo.json");
    expect(buildManifestUrl("/some/prefix/")).toBe("/some/prefix/equiseta-examples/manifest.json");
  });
});

// ---------------------------------------------------------------------
// fetchEquisetaExample / fetchEquisetaManifest — mock global fetch
// ---------------------------------------------------------------------

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(impl: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as Request | URL).toString();
    return Promise.resolve(impl(url));
  }) as unknown as typeof fetch;
}

describe("fetchEquisetaExample", () => {
  it("returns ok=true with text on 2xx", async () => {
    mockFetch(() => new Response('{"hello":"world"}', { status: 200 }));
    const r = await fetchEquisetaExample("xzz_memory.json", "/");
    expect(r).toEqual({ ok: true, text: '{"hello":"world"}' });
  });

  it("returns ok=false with HTTP code on 404", async () => {
    mockFetch(() => new Response("not found", { status: 404 }));
    const r = await fetchEquisetaExample("missing.json", "/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("404");
  });

  it("returns ok=false on network error", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    const r = await fetchEquisetaExample("foo.json", "/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("Failed to fetch");
  });

  it("uses non-root BASE_URL when supplied", async () => {
    let calledUrl = "";
    mockFetch((url) => {
      calledUrl = url;
      return new Response("{}", { status: 200 });
    });
    await fetchEquisetaExample("foo.json", "/piper/");
    expect(calledUrl).toBe("/piper/equiseta-examples/foo.json");
  });
});

describe("fetchEquisetaManifest", () => {
  it("returns ok=true with examples array on success", async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({
          examples: [{ filename: "x.json", name: "X", description: "desc" }],
        }),
        { status: 200 },
      ),
    );
    const r = await fetchEquisetaManifest("/");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.examples).toHaveLength(1);
  });

  it("returns ok=false on 404", async () => {
    mockFetch(() => new Response("not found", { status: 404 }));
    const r = await fetchEquisetaManifest("/");
    expect(r.ok).toBe(false);
  });

  it("returns ok=false when manifest shape is wrong", async () => {
    mockFetch(() => new Response('{"foo": 1}', { status: 200 }));
    const r = await fetchEquisetaManifest("/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("shape");
  });
});

// ---------------------------------------------------------------------
// getDroppedJsonText
// ---------------------------------------------------------------------

function makeDropEvent(files: File[]): { dataTransfer: { files: File[] } } {
  return { dataTransfer: { files } };
}

describe("getDroppedJsonText", () => {
  it("reads the first file's text on a single-file drop", async () => {
    const file = new File(['{"x":1}'], "x.json", { type: "application/json" });
    const r = await getDroppedJsonText(makeDropEvent([file]));
    expect(r).toEqual({ ok: true, text: '{"x":1}', filename: "x.json" });
  });

  it("returns no-file when dataTransfer is empty", async () => {
    const r = await getDroppedJsonText(makeDropEvent([]));
    expect(r).toEqual({ ok: false, reason: "no-file" });
  });

  it("returns wrong-ext for non-.json", async () => {
    const file = new File(["fake png bytes"], "img.png");
    const r = await getDroppedJsonText(makeDropEvent([file]));
    expect(r).toEqual({ ok: false, reason: "wrong-ext", ext: "png" });
  });

  it("treats the first file only (multi-file drops drop the rest)", async () => {
    const a = new File(['{"a":1}'], "a.json");
    const b = new File(['{"b":2}'], "b.json");
    const r = await getDroppedJsonText(makeDropEvent([a, b]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filename).toBe("a.json");
  });

  it("rejects oversized file", async () => {
    const bigText = "x".repeat(200);
    const file = new File([bigText], "big.json");
    expect(file.size).toBe(200);
    const r = await getDroppedJsonText(makeDropEvent([file]), 100);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "oversized") {
      expect(r.size).toBe(200);
      expect(r.maxBytes).toBe(100);
    }
  });
});

describe("MAX_BYTES is 5 MiB", () => {
  it("is 5 * 1024 * 1024", () => {
    expect(MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
