import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  INVALID_LINE_COLOR,
  INVALID_MESH_OPACITY,
  INVALID_SHADOW_COLOR,
  VALID_LINE_COLOR,
  VALID_MESH_OPACITY,
  VALID_SHADOW_COLOR,
  Y_OFFSET,
} from "../utils/groundShadow";
import { GroundShadowAbsolute } from "./GroundShadowAbsolute";

function meshMaterial(node: { instance: unknown }): THREE.MeshBasicMaterial {
  return (node.instance as THREE.Mesh).material as THREE.MeshBasicMaterial;
}
function lineMaterial(node: { instance: unknown }): THREE.LineBasicMaterial {
  return (node.instance as THREE.LineSegments).material as THREE.LineBasicMaterial;
}

describe("<GroundShadowAbsolute>", () => {
  it("renders nothing when on the ground (z=0)", async () => {
    const r = await ReactThreeTestRenderer.create(
      <GroundShadowAbsolute pos={{ x: 0, y: 0, z: 0 }} blockType="XZZ" valid />,
    );
    expect(r.scene.children).toHaveLength(0);
  });

  it("renders nothing when below ground (defensive)", async () => {
    const r = await ReactThreeTestRenderer.create(
      <GroundShadowAbsolute pos={{ x: 0, y: 0, z: -1 }} blockType="XZZ" valid />,
    );
    expect(r.scene.children).toHaveLength(0);
  });

  it("renders a group + mesh + line for an elevated cube", async () => {
    const r = await ReactThreeTestRenderer.create(
      <GroundShadowAbsolute pos={{ x: 3, y: 6, z: 2 }} blockType="XZZ" valid />,
    );
    const groups = r.scene.findAllByType("Group");
    expect(groups).toHaveLength(1);
    const group = groups[0];
    // World-space group at (cx, 0, cz) = (3.5, 0, -6.5)
    expect(group.instance.position.x).toBeCloseTo(3.5);
    expect(group.instance.position.y).toBeCloseTo(0);
    expect(group.instance.position.z).toBeCloseTo(-6.5);
    // Mesh + line live inside the group
    expect(r.scene.findAllByType("Mesh")).toHaveLength(1);
    expect(r.scene.findAllByType("LineSegments")).toHaveLength(1);
  });

  it("rotates mesh -PI/2 around X (lays plane flat) and lifts by Y_OFFSET", async () => {
    const r = await ReactThreeTestRenderer.create(
      <GroundShadowAbsolute pos={{ x: 0, y: 0, z: 2 }} blockType="XZZ" valid />,
    );
    const mesh = r.scene.findByType("Mesh");
    expect(mesh.instance.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(mesh.instance.position.y).toBeCloseTo(Y_OFFSET);
  });

  it("scales line to (1, lineLen, 1) so the unit-vertical geom spans block bottom", async () => {
    const r = await ReactThreeTestRenderer.create(
      <GroundShadowAbsolute pos={{ x: 0, y: 0, z: 5 }} blockType="XZZ" valid />,
    );
    const line = r.scene.findByType("LineSegments");
    expect(line.instance.scale.x).toBe(1);
    expect(line.instance.scale.y).toBeCloseTo(5 - Y_OFFSET);
    expect(line.instance.scale.z).toBe(1);
  });

  it("uses valid colors and full opacity at z=1 (no fade)", async () => {
    const r = await ReactThreeTestRenderer.create(
      <GroundShadowAbsolute pos={{ x: 0, y: 0, z: 1 }} blockType="XZZ" valid />,
    );
    const meshMat = meshMaterial(r.scene.findByType("Mesh"));
    const lineMat = lineMaterial(r.scene.findByType("LineSegments"));
    expect(meshMat.color.getHex()).toBe(VALID_SHADOW_COLOR);
    expect(lineMat.color.getHex()).toBe(VALID_LINE_COLOR);
    expect(meshMat.opacity).toBeCloseTo(VALID_MESH_OPACITY);
  });

  it("uses invalid red colors and full (non-faded) opacity when valid=false", async () => {
    const r = await ReactThreeTestRenderer.create(
      <GroundShadowAbsolute pos={{ x: 0, y: 0, z: 30 }} blockType="XZZ" valid={false} />,
    );
    const meshMat = meshMaterial(r.scene.findByType("Mesh"));
    const lineMat = lineMaterial(r.scene.findByType("LineSegments"));
    expect(meshMat.color.getHex()).toBe(INVALID_SHADOW_COLOR);
    expect(lineMat.color.getHex()).toBe(INVALID_LINE_COLOR);
    // Invalid skips elevation falloff: full base opacity even at z=30
    expect(meshMat.opacity).toBe(INVALID_MESH_OPACITY);
  });

  it("respects pipe footprint dims (X-open pipe centers at offset 1, 0.5)", async () => {
    const r = await ReactThreeTestRenderer.create(
      <GroundShadowAbsolute pos={{ x: 0, y: 0, z: 2 }} blockType="OZX" valid />,
    );
    const group = r.scene.findByType("Group");
    expect(group.instance.position.x).toBeCloseTo(1);
    expect(group.instance.position.z).toBeCloseTo(-0.5);
  });
});
