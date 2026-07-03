// ---------------------------------------------------------------------------
// htmlExport — bake the current scene into raw geometry arrays and wrap them in
// a self-contained <iframe> snippet the user can paste into their own webpage.
//
// The snippet loads three.js from a CDN (pinned to the version below) and
// rebuilds BufferGeometry from the inlined arrays, so the paste-able chunk stays
// a few KB. We reuse the app's own pure geometry functions at BAKE time — the
// per-block instance transform is a pure translation (see BlockInstances.tsx),
// so baking = clone each geometry, add the translation to every vertex, and
// concatenate. No geometry logic is duplicated inside the iframe.
// ---------------------------------------------------------------------------

import {
  createBlockGeometry,
  createBlockEdges,
  createYDefectEdges,
  tqecToThree,
  yBlockZOffset,
  posKey,
} from "../types";
import type { Block, FaceMask } from "../types";
import type { SurfacePiece } from "./flows";

// Keep in lockstep with the installed three version (gui/package.json).
const THREE_CDN_VERSION = "0.184.0";

// Per-basis correlation-surface colors (match FlowSurfaceOverlay.tsx).
const SURFACE_COLOR: Record<"X" | "Z", string> = { X: "#ff7f7f", Z: "#7396ff" };

export interface BakedScene {
  mesh: {
    positions: Float32Array;
    normals: Float32Array;
    colors: Float32Array;
    index: Uint32Array;
  };
  edges: { positions: Float32Array };
  yDefectEdges?: { positions: Float32Array };
  // Opaque, unlit correlation-surface meshes (one per basis present).
  surfaces: Array<{ positions: Float32Array; index: Uint32Array; color: string }>;
  bounds: { center: [number, number, number]; diameter: number };
}

/**
 * Bucket correlation-surface quads by basis into indexed mesh arrays, growing
 * the running bbox (min/max) in place. Each piece is a quad → two triangles.
 * Vertices need no tqecToThree transform: the backend emits them in world coords.
 */
function bakeSurfaces(
  surfaces: SurfacePiece[],
  min: number[],
  max: number[],
): BakedScene["surfaces"] {
  const buckets: Record<"X" | "Z", { pos: number[]; idx: number[] }> = {
    X: { pos: [], idx: [] },
    Z: { pos: [], idx: [] },
  };
  for (const piece of surfaces) {
    const bucket = piece.basis === "X" ? buckets.X : buckets.Z;
    const base = bucket.pos.length / 3;
    for (let i = 0; i < piece.vertices.length; i += 3) {
      const x = piece.vertices[i], y = piece.vertices[i + 1], z = piece.vertices[i + 2];
      bucket.pos.push(x, y, z);
      if (x < min[0]) min[0] = x;
      if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y;
      if (y > max[1]) max[1] = y;
      if (z < min[2]) min[2] = z;
      if (z > max[2]) max[2] = z;
    }
    bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const out: BakedScene["surfaces"] = [];
  for (const basis of ["X", "Z"] as const) {
    const b = buckets[basis];
    if (b.pos.length > 0) {
      out.push({
        positions: new Float32Array(b.pos),
        index: new Uint32Array(b.idx),
        color: SURFACE_COLOR[basis],
      });
    }
  }
  return out;
}

/**
 * Bake every block's geometry (mesh + black edges + optional Y-defect edges)
 * into merged typed arrays in Three.js world space. Mirrors the batched-edge
 * loop in BlockInstances.tsx: each block is translated by
 * tqecToThree(pos, type, zOffset) — a pure translation, so normals are unchanged.
 */
export function bakeScene(
  blocks: Map<string, Block>,
  hiddenFaces: Map<string, FaceMask>,
  showYDefects: boolean,
  surfaces?: SurfacePiece[] | null,
): BakedScene {
  const posA: number[] = [];
  const normA: number[] = [];
  const colA: number[] = [];
  const idxA: number[] = [];
  const edgeA: number[] = [];
  const yEdgeA: number[] = [];
  let vertBase = 0;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const block of blocks.values()) {
    const hf = hiddenFaces.get(posKey(block.pos)) ?? 0;
    const zo = block.type === "Y" ? yBlockZOffset(block.pos, blocks) : 0;
    const [tx, ty, tz] = tqecToThree(block.pos, block.type, zo);

    // --- mesh (indexed; position + normal + color) ---
    const geo = createBlockGeometry(block.type, hf);
    const p = geo.getAttribute("position");
    const n = geo.getAttribute("normal");
    const c = geo.getAttribute("color");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + tx;
      const y = p.getY(i) + ty;
      const z = p.getZ(i) + tz;
      posA.push(x, y, z);
      normA.push(n.getX(i), n.getY(i), n.getZ(i));
      colA.push(c.getX(i), c.getY(i), c.getZ(i));
      if (x < min[0]) min[0] = x;
      if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y;
      if (y > max[1]) max[1] = y;
      if (z < min[2]) min[2] = z;
      if (z > max[2]) max[2] = z;
    }
    const index = geo.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) idxA.push(index.getX(i) + vertBase);
    } else {
      // Defensive: emit a sequential triangle list if a variant is non-indexed.
      for (let i = 0; i < p.count; i++) idxA.push(i + vertBase);
    }
    vertBase += p.count;
    geo.dispose();

    // --- black edges (non-indexed, position-only line segments) ---
    const eg = createBlockEdges(block.type, hf);
    const ep = eg.getAttribute("position");
    for (let i = 0; i < ep.count; i++) {
      edgeA.push(ep.getX(i) + tx, ep.getY(i) + ty, ep.getZ(i) + tz);
    }
    eg.dispose();

    // --- optional magenta Y-defect edges ---
    if (showYDefects) {
      const yg = createYDefectEdges(block.type, hf);
      const yp = yg.getAttribute("position");
      for (let i = 0; i < yp.count; i++) {
        yEdgeA.push(yp.getX(i) + tx, yp.getY(i) + ty, yp.getZ(i) + tz);
      }
      yg.dispose();
    }
  }

  const surfacesOut = bakeSurfaces(surfaces ?? [], min, max);

  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const diameter = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  return {
    mesh: {
      positions: new Float32Array(posA),
      normals: new Float32Array(normA),
      colors: new Float32Array(colA),
      index: new Uint32Array(idxA),
    },
    edges: { positions: new Float32Array(edgeA) },
    yDefectEdges: showYDefects && yEdgeA.length > 0 ? { positions: new Float32Array(yEdgeA) } : undefined,
    surfaces: surfacesOut,
    bounds: { center, diameter },
  };
}

/** Inline a numeric array, rounded to 5 dp to shrink the payload. */
function arr(a: ArrayLike<number>): string {
  return JSON.stringify(Array.from(a, (v) => Math.round(v * 1e5) / 1e5));
}

// Static tail of the iframe module: camera framing, on-demand render, resize.
// `render` is a hoisted function declaration, so the setup part's message
// listener can call it even though it's declared here (appended after).
const CAMERA_LOOP_SCRIPT = `
const FOV = 35;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100000);
const controls = new OrbitControls(camera, canvas);
controls.target.set(CENTER[0], CENTER[1], CENTER[2]);

function render() { renderer.render(scene, camera); }

function frame() {
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const vFov = FOV * Math.PI / 180;
  const fitH = (DIAM / 2) / Math.tan(vFov / 2);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const fitW = (DIAM / 2) / Math.tan(hFov / 2);
  const distance = Math.max(fitH, fitW) * 1.2;
  const d = new THREE.Vector3(1, 1, -1).normalize();
  camera.position.set(CENTER[0], CENTER[1], CENTER[2]).addScaledVector(d, distance);
  camera.near = Math.max(0.1, distance / 1000);
  camera.far = distance * 10 + DIAM;
  camera.updateProjectionMatrix();
  controls.update();
  render();
}
frame();
addEventListener('resize', frame);
// Render only when the view actually changes — no idle GPU/CPU churn.
controls.addEventListener('change', render);`;

/** The ES-module body that reconstructs and renders the scene inside the iframe. */
function buildModuleScript(scene: BakedScene, opacity: number): string {
  const { mesh, edges, yDefectEdges, bounds, surfaces } = scene;
  const yEdges = yDefectEdges ? arr(yDefectEdges.positions) : "null";
  const surfInit = surfaces
    .map((s) => `{p:${arr(s.positions)},i:${arr(s.index)},c:${JSON.stringify(s.color)}}`)
    .join(",");
  // Correlation surfaces: opaque, unlit, double-sided (per basis). Omitted
  // entirely when none are shown, so the snippet carries no dead code.
  const surfBlock = surfaces.length
    ? `\nfor (const s of [${surfInit}]) {
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(s.p, 3));
  sg.setIndex(s.i);
  scene.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: s.c, side: THREE.DoubleSide })));
}\n`
    : "";

  const setup = `import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const POS = ${arr(mesh.positions)};
const NORM = ${arr(mesh.normals)};
const COL = ${arr(mesh.colors)};
const IDX = ${arr(mesh.index)};
const EDGE = ${arr(edges.positions)};
const YEDGE = ${yEdges};
const CENTER = ${arr(bounds.center)};
const DIAM = ${Math.round(bounds.diameter * 1e5) / 1e5} || 1;
const OPACITY = ${Math.round(opacity * 1000) / 1000};

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#CBDFC6');
scene.add(new THREE.AmbientLight(0xffffff, 1.4));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(10, 10, 10);
scene.add(dir);

const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.Float32BufferAttribute(POS, 3));
g.setAttribute('normal', new THREE.Float32BufferAttribute(NORM, 3));
g.setAttribute('color', new THREE.Float32BufferAttribute(COL, 3));
g.setIndex(IDX);
const material = new THREE.MeshLambertMaterial({
  vertexColors: true, side: THREE.DoubleSide,
  transparent: OPACITY < 1, opacity: OPACITY, depthWrite: true,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
scene.add(new THREE.Mesh(g, material));

// Live opacity control for the in-app preview (harmless when pasted elsewhere).
addEventListener('message', (e) => {
  const o = e.data && e.data.__piperOpacity;
  if (typeof o === 'number') {
    material.opacity = o;
    material.transparent = o < 1;
    material.needsUpdate = true;
    render();
  }
});

const eg = new THREE.BufferGeometry();
eg.setAttribute('position', new THREE.Float32BufferAttribute(EDGE, 3));
scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x000000 })));
${surfBlock}
if (YEDGE) {
  const yg = new THREE.BufferGeometry();
  yg.setAttribute('position', new THREE.Float32BufferAttribute(YEDGE, 3));
  scene.add(new THREE.LineSegments(yg, new THREE.LineBasicMaterial({ color: 0xff39c2 })));
}
`;
  return setup + CAMERA_LOOP_SCRIPT;
}

/**
 * Build the inner <!doctype html> document that the iframe renders. This is what
 * the modal previews via React srcDoc, and (after escaping) what goes inside the
 * copied <iframe srcdoc="…">. Renderer / lights / background / tone-mapping /
 * camera mirror App.tsx + PreviewRenderer.tsx so the embed matches the app.
 *
 * @param opacity block opacity in [0,1] (edges + Y-defects stay fully opaque)
 */
export function renderIframeDoc(scene: BakedScene, opacity: number): string {
  const cdn = `https://cdn.jsdelivr.net/npm/three@${THREE_CDN_VERSION}`;
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden}#c{width:100%;height:100%;display:block}</style>
<script type="importmap">
{ "imports": {
  "three": "${cdn}/build/three.module.js",
  "three/addons/": "${cdn}/examples/jsm/"
}}
</script></head>
<body><canvas id="c"></canvas>
<script type="module">
${buildModuleScript(scene, opacity)}
</script></body></html>`;
}

/**
 * Wrap the inner document into a paste-able <iframe srcdoc="…"> element.
 * Escape for a double-quoted attribute: & first, then " (the numeric payload
 * contains no other characters that need escaping).
 */
export function buildIframeSnippet(innerDoc: string): string {
  const escaped = innerDoc.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<iframe srcdoc="${escaped}" style="width:100%;height:480px;border:0" title="piper-draw model"></iframe>`;
}
