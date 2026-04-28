import { describe, expect, it } from "vitest";
import type { Block } from "../types";
import type { SceneSnapshotV1 } from "./sceneSnapshot";
import {
  buildShareUrl,
  decodeSnapshotFromHash,
  encodeSnapshotToHashParam,
  isCompressionStreamSupported,
  parseSceneHashParam,
} from "./sceneShare";

function snapshot(
  blocks: Array<[string, Block]> = [],
  portMeta: SceneSnapshotV1["portMeta"] = [],
  portPositions: string[] = [],
): SceneSnapshotV1 {
  return { v: 1, blocks, portMeta, portPositions };
}

describe("parseSceneHashParam", () => {
  it("extracts the scene parameter from various hash forms", () => {
    expect(parseSceneHashParam("#scene=abc")).toBe("abc");
    expect(parseSceneHashParam("scene=abc")).toBe("abc");
    expect(parseSceneHashParam("?scene=abc")).toBe("abc");
    expect(parseSceneHashParam("#foo=1&scene=abc")).toBe("abc");
    expect(parseSceneHashParam("#scene=abc&foo=1")).toBe("abc");
    expect(parseSceneHashParam("https://x.test/app#scene=abc")).toBe("abc");
  });

  it("returns null when no scene param is present", () => {
    expect(parseSceneHashParam("")).toBe(null);
    expect(parseSceneHashParam("#")).toBe(null);
    expect(parseSceneHashParam("#otherkey=value")).toBe(null);
    expect(parseSceneHashParam("scenefoo=bar")).toBe(null);
  });
});

describe("buildShareUrl", () => {
  it("appends the encoded payload to the supplied base", () => {
    expect(buildShareUrl("xyz", "https://app.test/")).toBe(
      "https://app.test/#scene=xyz",
    );
  });
});

const compressionAvailable = isCompressionStreamSupported();
const skipIfNoCompression = compressionAvailable ? describe : describe.skip;

skipIfNoCompression("encode/decode round-trip", () => {
  it("round-trips an empty scene", async () => {
    const original = snapshot();
    const encoded = await encodeSnapshotToHashParam(original);
    const decoded = await decodeSnapshotFromHash(`#scene=${encoded}`);
    expect(decoded).toEqual(original);
  });

  it("round-trips a small scene with port meta and ranks", async () => {
    const blocks: Array<[string, Block]> = [
      ["0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" }],
      ["3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "OZX" }],
      ["6,0,0", { pos: { x: 6, y: 0, z: 0 }, type: "ZXZ" }],
    ];
    const original = snapshot(
      blocks,
      [
        ["0,0,0", { label: "P1", io: "in", rank: 0 }],
        ["6,0,0", { label: "P2", io: "out", rank: 1 }],
      ],
      ["0,0,0", "6,0,0"],
    );
    const encoded = await encodeSnapshotToHashParam(original);
    const decoded = await decodeSnapshotFromHash(`#scene=${encoded}`);
    expect(decoded).toEqual(original);
  });

  it("round-trips a 200-block scene and produces base64url-safe output", async () => {
    const blocks: Array<[string, Block]> = [];
    for (let i = 0; i < 200; i++) {
      const x = (i % 20) * 3;
      const z = Math.floor(i / 20) * 3;
      blocks.push([`${x},0,${z}`, { pos: { x, y: 0, z }, type: "XZZ" }]);
    }
    const original = snapshot(blocks);
    const encoded = await encodeSnapshotToHashParam(original);
    expect(/^[A-Za-z0-9_-]+$/.test(encoded)).toBe(true);
    const decoded = await decodeSnapshotFromHash(`#scene=${encoded}`);
    expect(decoded).toEqual(original);
  });

  it("returns null for a malformed base64 payload", async () => {
    expect(await decodeSnapshotFromHash("#scene=!!!not-base64")).toBe(null);
  });

  it("returns null when valid base64 is not deflate-compressed", async () => {
    expect(await decodeSnapshotFromHash("#scene=aGVsbG8")).toBe(null);
  });

  it("returns null when the decoded JSON has the wrong shape", async () => {
    const wrongShape = await encodeSnapshotToHashParam({
      v: 1,
      blocks: "not-an-array" as unknown as never,
      portMeta: [],
      portPositions: [],
    } as SceneSnapshotV1);
    expect(await decodeSnapshotFromHash(`#scene=${wrongShape}`)).toBe(null);
  });

  it("returns null when there is no scene param", async () => {
    expect(await decodeSnapshotFromHash("#nothing-here")).toBe(null);
  });
});
