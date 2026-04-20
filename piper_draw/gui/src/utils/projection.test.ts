import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Block } from "../types";
import { getBlockKeysInScreenRect } from "./projection";

function mkCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

function blockAt(key: string, pos: { x: number; y: number; z: number }): [string, Block] {
  return [key, { pos, type: "XZZ" as const }];
}

describe("getBlockKeysInScreenRect", () => {
  it("returns the empty array when no blocks are supplied", () => {
    const cam = mkCamera();
    expect(getBlockKeysInScreenRect(new Map(), cam, 800, 600, { x1: 0, y1: 0, x2: 800, y2: 600 })).toEqual([]);
  });

  it("finds a block whose projected center is inside the rect", () => {
    const cam = mkCamera();
    // tqecToThree((-1, 0, -1), "XZZ") = (-0.5, -0.5, -0.5): near the view target.
    const blocks = new Map([blockAt("a", { x: -1, y: 0, z: -1 })]);
    const keys = getBlockKeysInScreenRect(blocks, cam, 800, 600, {
      x1: 0, y1: 0, x2: 800, y2: 600,
    });
    expect(keys).toEqual(["a"]);
  });

  it("excludes blocks whose projected center falls outside the rect", () => {
    const cam = mkCamera();
    const blocks = new Map([
      blockAt("center", { x: -1, y: 0, z: -1 }),
      blockAt("far_right", { x: 50, y: 0, z: -1 }),
    ]);
    const keys = getBlockKeysInScreenRect(blocks, cam, 800, 600, {
      x1: 0, y1: 0, x2: 400, y2: 600,
    });
    expect(keys).toContain("center");
    expect(keys).not.toContain("far_right");
  });

  it("skips blocks behind the camera", () => {
    const cam = mkCamera();
    // Camera at three-z=10 looking -Z. tqecToThree puts -(pos.y + 0.5) into
    // three-z, so pos.y = -30 → world three-z = 29.5, which is behind the camera.
    const blocks = new Map([blockAt("behind", { x: -1, y: -30, z: -1 })]);
    const keys = getBlockKeysInScreenRect(blocks, cam, 800, 600, {
      x1: 0, y1: 0, x2: 800, y2: 600,
    });
    expect(keys).toEqual([]);
  });

  it("normalizes a reversed rectangle (x2 < x1, y2 < y1)", () => {
    const cam = mkCamera();
    const blocks = new Map([blockAt("center", { x: -1, y: 0, z: -1 })]);
    const keys = getBlockKeysInScreenRect(blocks, cam, 800, 600, {
      x1: 800, y1: 600, x2: 0, y2: 0,
    });
    expect(keys).toEqual(["center"]);
  });
});
