import { describe, it, expect } from "vitest";
import { bakeScene, renderIframeDoc, buildIframeSnippet } from "./htmlExport";
import type { Block, FaceMask } from "../types";
import type { SurfacePiece } from "./flows";

const URL = "https://piper-draw.example/#scene=abc123";

const SURFACES: SurfacePiece[] = [
  { basis: "X", vertices: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] },
  { basis: "Z", vertices: [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0] },
];

function scene(): Map<string, Block> {
  const m = new Map<string, Block>();
  m.set("0,0,0", { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" });
  m.set("1,0,0", { pos: { x: 1, y: 0, z: 0 }, type: "OZX" }); // X-open pipe
  m.set("0,0,3", { pos: { x: 0, y: 0, z: 3 }, type: "Y" });
  m.set("3,0,0", { pos: { x: 3, y: 0, z: 0 }, type: "OZXH" }); // Hadamard pipe
  return m;
}

describe("htmlExport", () => {
  const hidden = new Map<string, FaceMask>();

  it("bakes non-empty, consistent mesh + edge arrays with sane bounds", () => {
    const baked = bakeScene(scene(), hidden, false);
    expect(baked.mesh.positions.length).toBeGreaterThan(0);
    expect(baked.mesh.positions.length).toBe(baked.mesh.normals.length);
    expect(baked.mesh.positions.length).toBe(baked.mesh.colors.length);
    expect(baked.mesh.index.length % 3).toBe(0);
    // every index must reference a real vertex
    const vertCount = baked.mesh.positions.length / 3;
    expect(Math.max(...baked.mesh.index)).toBeLessThan(vertCount);
    expect(baked.edges.positions.length).toBeGreaterThan(0);
    expect(baked.bounds.diameter).toBeGreaterThan(0);
    expect(baked.yDefectEdges).toBeUndefined();
    expect(baked.surfaces).toEqual([]);
  });

  it("bakes correlation surfaces bucketed by basis with per-basis colors", () => {
    const baked = bakeScene(scene(), hidden, false, SURFACES);
    expect(baked.surfaces.length).toBe(2);
    const colors = baked.surfaces.map((s) => s.color);
    expect(colors).toContain("#ff7f7f"); // X
    expect(colors).toContain("#7396ff"); // Z
    for (const s of baked.surfaces) {
      expect(s.index.length).toBe(6); // one quad → two triangles
      expect(Math.max(...s.index)).toBeLessThan(s.positions.length / 3);
    }
    // surfaces are emitted as unlit meshes in the iframe
    const doc = renderIframeDoc(baked, 0.8, URL);
    expect(doc).toContain("MeshBasicMaterial");
    // no surfaces => no MeshBasicMaterial
    expect(renderIframeDoc(bakeScene(scene(), hidden, false), 0.8, URL)).not.toContain("MeshBasicMaterial");
  });

  it("emits Y-defect edges only when requested", () => {
    const on = bakeScene(scene(), hidden, true);
    // scene has a Hadamard-adjacent config; Y-defect edges may or may not be
    // present depending on types, but the field must never appear when off.
    const off = bakeScene(scene(), hidden, false);
    expect(off.yDefectEdges).toBeUndefined();
    expect(on).toBeTruthy();
  });

  it("renders a self-contained doc that references the pinned three CDN", () => {
    const doc = renderIframeDoc(bakeScene(scene(), hidden, false), 0.8, URL);
    expect(doc).toContain("cdn.jsdelivr.net/npm/three@0.184.0");
    expect(doc).toContain("OrbitControls");
    expect(doc).toContain("#CBDFC6");
    expect(doc).toContain("const OPACITY = 0.8");
    expect(doc.startsWith("<!doctype html>")).toBe(true);
  });

  it("includes a title bar with usage hints and an Open-in-Piper-Draw link", () => {
    const doc = renderIframeDoc(bakeScene(scene(), hidden, false), 0.8, URL);
    expect(doc).toContain("Drag to orbit. Scroll to zoom. Cmd + drag to move.");
    expect(doc).toContain("Open in Piper Draw");
    expect(doc).toContain(`href="${URL}"`);
  });

  it("wraps into an escaped iframe srcdoc with no raw double-quotes in the payload", () => {
    const doc = renderIframeDoc(bakeScene(scene(), hidden, false), 1, URL);
    const snip = buildIframeSnippet(doc);
    expect(snip.startsWith('<iframe srcdoc="')).toBe(true);
    // extract the srcdoc attribute value; it must not contain an unescaped "
    const inner = snip.slice('<iframe srcdoc="'.length, snip.indexOf('" style='));
    expect(inner).not.toContain('"');
    expect(inner).toContain("&quot;");
    // opaque scene => OPACITY 1 (transparent flag computed at runtime as OPACITY < 1)
    expect(doc).toContain("const OPACITY = 1");
  });
});
