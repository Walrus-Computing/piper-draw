import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import {
  CUBE_TYPES,
  VARIANT_AXIS_MAP,
  createBlockGeometry,
  createBlockEdges,
  blockThreeSize,
} from "../types";
import type { BlockType, PipeVariant, ViewMode } from "../types";
import { useBlockStore } from "../stores/blockStore";
import {
  FOLD_ANGLE,
  isoTopThreeAxis,
  colorForCubeFaceThreeAxis,
  faceOrientationEuler,
  foldRotationEuler,
} from "../utils/isoFoldOut";
import type { ThreeAxis } from "../utils/isoFoldOut";

/**
 * All block types to render previews for, including pipe canonical forms.
 * `isoZBlockType` (pipes only) overrides `blockType` in iso-z mode so that
 * the preview shows a horizontal pipe (lying in the xy plane) as seen from
 * above, matching how the pipe will actually be placed in that mode.
 */
const PREVIEW_TYPES: { key: string; blockType: BlockType; isoZBlockType?: BlockType }[] = [
  ...CUBE_TYPES.map((ct) => ({ key: ct, blockType: ct as BlockType })),
  { key: "Y", blockType: "Y" as BlockType },
  ...(["ZX", "XZ", "ZXH", "XZH"] as PipeVariant[]).map((v) => ({
    key: v,
    blockType: VARIANT_AXIS_MAP[v][2] as BlockType,
    isoZBlockType: VARIANT_AXIS_MAP[v][0] as BlockType,
  })),
];

const RENDER_SIZE = 128; // high-res for crisp previews at any display size
const FOV = 35;
const THROTTLE_MS = 66; // ~15fps
const HALF = 0.5;

const vertexColorMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });

const foldFaceMatCache = new Map<number, THREE.MeshBasicMaterial>();
function foldFaceMaterial(color: THREE.Color): THREE.MeshBasicMaterial {
  const key = color.getHex();
  let mat = foldFaceMatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    foldFaceMatCache.set(key, mat);
  }
  return mat;
}

type Variant = "persp" | "iso-x" | "iso-y" | "iso-z";
const FOLD_VARIANTS: Exclude<Variant, "persp">[] = ["iso-x", "iso-y", "iso-z"];

function variantForViewMode(viewMode: ViewMode): Variant {
  if (viewMode.kind === "persp") return "persp";
  if (viewMode.axis === "x") return "iso-x";
  if (viewMode.axis === "y") return "iso-y";
  return "iso-z";
}

function variantTopAxis(variant: Exclude<Variant, "persp">): ThreeAxis {
  if (variant === "iso-x") return isoTopThreeAxis("x");
  if (variant === "iso-y") return isoTopThreeAxis("y");
  return isoTopThreeAxis("z");
}

function variantKey(key: string, variant: Variant): string {
  return `${key}|${variant}`;
}

type PreviewEntry = {
  obj: THREE.Object3D;
  edges: THREE.Object3D;
  center: THREE.Vector3;
  radius: number;
};

function buildRegularEntry(blockType: BlockType): PreviewEntry {
  const previewBandHH = blockType.toString().endsWith("H") ? 0.16 : undefined;
  const geo = createBlockGeometry(blockType, 0, previewBandHH);
  const mesh = new THREE.Mesh(geo, vertexColorMaterial);

  const edgeGeo = createBlockEdges(blockType, 0, previewBandHH);
  const edges = new THREE.LineSegments(edgeGeo, edgeMaterial);

  const [sx, sy, sz] = blockThreeSize(blockType);
  const center = new THREE.Vector3(0, 0, 0);
  const radius = Math.sqrt(sx * sx + sy * sy + sz * sz) / 2;

  return { obj: mesh, edges, center, radius };
}

function addFoldOutFace(
  meshGroup: THREE.Group,
  edgeGroup: THREE.Group,
  axis: ThreeAxis,
  sign: 1 | -1,
  topAxis: ThreeAxis,
  foldAngle: number,
  color: THREE.Color,
): void {
  const geo = new THREE.PlaneGeometry(1, 1);

  let m: THREE.Matrix4;
  if (axis === topAxis) {
    const orient = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(...faceOrientationEuler(topAxis, 1)),
    );
    const pos: [number, number, number] = [0, 0, 0];
    pos[topAxis] = HALF;
    m = new THREE.Matrix4().makeTranslation(pos[0], pos[1], pos[2]).multiply(orient);
  } else {
    const orient = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(...faceOrientationEuler(axis, sign)),
    );
    const facePosLocal: [number, number, number] = [0, 0, 0];
    facePosLocal[topAxis] = -HALF;
    const facePosLocalMat = new THREE.Matrix4().makeTranslation(
      facePosLocal[0], facePosLocal[1], facePosLocal[2],
    );
    const foldMat = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(...foldRotationEuler(axis, sign, topAxis, foldAngle)),
    );
    const pivot: [number, number, number] = [0, 0, 0];
    pivot[axis] = sign * HALF;
    pivot[topAxis] = HALF;
    const pivotMat = new THREE.Matrix4().makeTranslation(pivot[0], pivot[1], pivot[2]);
    m = new THREE.Matrix4()
      .multiplyMatrices(pivotMat, foldMat)
      .multiply(facePosLocalMat)
      .multiply(orient);
  }
  geo.applyMatrix4(m);

  meshGroup.add(new THREE.Mesh(geo, foldFaceMaterial(color)));
  edgeGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMaterial));
}

function buildFoldOutCubeEntry(blockType: string, topAxis: ThreeAxis): PreviewEntry {
  const meshGroup = new THREE.Group();
  const edgeGroup = new THREE.Group();

  addFoldOutFace(meshGroup, edgeGroup, topAxis, 1, topAxis, 0, colorForCubeFaceThreeAxis(blockType, topAxis));

  const sides = ([0, 1, 2] as ThreeAxis[]).filter(a => a !== topAxis);
  for (const a of sides) {
    for (const s of [1, -1] as const) {
      addFoldOutFace(meshGroup, edgeGroup, a, s, topAxis, FOLD_ANGLE, colorForCubeFaceThreeAxis(blockType, a));
    }
  }

  // After fold by π/6, max corner extends to ~1.18 from origin; pick a slightly smaller
  // radius so the camera frames the cube body comparably to the regular preview.
  return { obj: meshGroup, edges: edgeGroup, center: new THREE.Vector3(0, 0, 0), radius: 1.05 };
}

/**
 * Hook that renders 3D preview images for all toolbar block/pipe types,
 * synced to the main camera's orientation via controlsRef. In iso view modes,
 * cubes are rendered as fold-out previews (4 side faces tilted outward from the
 * camera-facing top) so the user can read the colors of every face.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function usePreviewImages(controlsRef: React.RefObject<any>) {
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshesRef = useRef<Map<string, PreviewEntry>>(new Map());
  const lastQuatRef = useRef(new THREE.Quaternion());
  const lastVariantRef = useRef<Variant>("persp");
  const rafRef = useRef(0);
  const lastRenderRef = useRef(0);
  const dirVec = useRef(new THREE.Vector3());

  const init = useCallback(() => {
    if (rendererRef.current) return;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(RENDER_SIZE, RENDER_SIZE);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(10, 10, 10);
    scene.add(dirLight);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    cameraRef.current = camera;

    // Pre-build entries: each block has a "persp" variant; cubes additionally
    // have iso-x / iso-y / iso-z fold-out variants. Non-cube types share the
    // regular entry across variants, except pipes use isoZBlockType for iso-z.
    for (const { key, blockType, isoZBlockType } of PREVIEW_TYPES) {
      const isCube = (CUBE_TYPES as readonly string[]).includes(blockType);
      const regular = buildRegularEntry(blockType);
      meshesRef.current.set(variantKey(key, "persp"), regular);

      if (isCube) {
        for (const v of FOLD_VARIANTS) {
          meshesRef.current.set(variantKey(key, v), buildFoldOutCubeEntry(blockType, variantTopAxis(v)));
        }
      } else {
        const isoZ = isoZBlockType ? buildRegularEntry(isoZBlockType) : regular;
        for (const v of FOLD_VARIANTS) {
          meshesRef.current.set(variantKey(key, v), v === "iso-z" ? isoZ : regular);
        }
      }
    }
  }, []);

  useEffect(() => {
    init();

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);

      const now = performance.now();
      if (now - lastRenderRef.current < THROTTLE_MS) return;

      const controls = controlsRef.current;
      if (!controls) return;
      const mainCamera = controls.object as THREE.PerspectiveCamera;
      if (!mainCamera) return;

      const variant = variantForViewMode(useBlockStore.getState().viewMode);
      const quat = mainCamera.quaternion;
      const quatChanged = lastQuatRef.current.angleTo(quat) >= 0.005;
      const variantChanged = lastVariantRef.current !== variant;
      if (!quatChanged && !variantChanged) return;
      lastQuatRef.current.copy(quat);
      lastVariantRef.current = variant;
      lastRenderRef.current = now;

      const renderer = rendererRef.current!;
      const scene = sceneRef.current!;
      const camera = cameraRef.current!;

      // Compute camera direction from main camera's quaternion
      const dir = dirVec.current.set(0, 0, 1).applyQuaternion(quat);

      const newImages = new Map<string, string>();

      for (const { key } of PREVIEW_TYPES) {
        const entry = meshesRef.current.get(variantKey(key, variant))!;

        // Swap preview object: remove previous, add current
        if (scene.children.length > 2) {
          scene.remove(scene.children[scene.children.length - 1]);
          scene.remove(scene.children[scene.children.length - 1]);
        }
        scene.add(entry.obj);
        scene.add(entry.edges);

        // Position camera to frame the block
        const dist = entry.radius / Math.tan((FOV * Math.PI) / 360) * 1.3;
        camera.position.copy(entry.center).addScaledVector(dir, dist);
        camera.quaternion.copy(quat);

        renderer.render(scene, camera);
        newImages.set(key, renderer.domElement.toDataURL());
      }

      setImages(newImages);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      const seen = new Set<PreviewEntry>();
      for (const entry of meshesRef.current.values()) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        entry.obj.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry.dispose();
        });
        entry.edges.traverse((node) => {
          const ls = node as THREE.LineSegments;
          if (ls.isLineSegments) ls.geometry.dispose();
        });
      }
      meshesRef.current.clear();
      rendererRef.current?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, [controlsRef, init]);

  return images;
}
