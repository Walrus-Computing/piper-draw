import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import {
  CUBE_TYPES,
  createBlockGeometry,
  createBlockEdges,
  blockThreeSize,
} from "../types";
import type { BlockType } from "../types";

/** All block types to render previews for, including pipe canonical forms. */
const PREVIEW_TYPES: { key: string; blockType: BlockType }[] = [
  ...CUBE_TYPES.map((ct) => ({ key: ct, blockType: ct as BlockType })),
  { key: "Y", blockType: "Y" as BlockType },
  { key: "ZX", blockType: "ZXO" as BlockType },
  { key: "XZ", blockType: "XZO" as BlockType },
  { key: "ZXH", blockType: "ZXOH" as BlockType },
  { key: "XZH", blockType: "XZOH" as BlockType },
];

const RENDER_SIZE = 128; // high-res for crisp previews at any display size
const FOV = 35;
const THROTTLE_MS = 66; // ~15fps

const vertexColorMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });

/**
 * Hook that renders 3D preview images for all toolbar block/pipe types,
 * synced to the main camera's orientation via controlsRef.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function usePreviewImages(controlsRef: React.RefObject<any>) {
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshesRef = useRef<Map<string, { mesh: THREE.Mesh; edges: THREE.LineSegments; center: THREE.Vector3; radius: number }>>(new Map());
  const lastQuatRef = useRef(new THREE.Quaternion());
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

    // Pre-build meshes
    for (const { key, blockType } of PREVIEW_TYPES) {
      const geo = createBlockGeometry(blockType, 0);
      const mesh = new THREE.Mesh(geo, vertexColorMaterial);

      const edgeGeo = createBlockEdges(blockType, 0);
      const edges = new THREE.LineSegments(edgeGeo, edgeMaterial);

      const [sx, sy, sz] = blockThreeSize(blockType);
      const center = new THREE.Vector3(0, 0, 0);
      const radius = Math.sqrt(sx * sx + sy * sy + sz * sz) / 2;

      meshesRef.current.set(key, { mesh, edges, center, radius });
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

      // Check if camera orientation changed
      const quat = mainCamera.quaternion;
      if (lastQuatRef.current.angleTo(quat) < 0.005) return;
      lastQuatRef.current.copy(quat);
      lastRenderRef.current = now;

      const renderer = rendererRef.current!;
      const scene = sceneRef.current!;
      const camera = cameraRef.current!;

      // Compute camera direction from main camera's quaternion
      const dir = dirVec.current.set(0, 0, 1).applyQuaternion(quat);

      const newImages = new Map<string, string>();

      for (const { key } of PREVIEW_TYPES) {
        const entry = meshesRef.current.get(key)!;

        // Swap preview mesh: remove previous, add current
        if (scene.children.length > 2) {
          scene.remove(scene.children[scene.children.length - 1]);
          scene.remove(scene.children[scene.children.length - 1]);
        }
        scene.add(entry.mesh);
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
      for (const entry of meshesRef.current.values()) {
        entry.mesh.geometry.dispose();
        entry.edges.geometry.dispose();
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
