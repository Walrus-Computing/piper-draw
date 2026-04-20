import { useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame, useThree } from "@react-three/fiber";
import { useBlockStore } from "../stores/blockStore";
import {
  snapGroundPos,
  snapInPlane,
  hasBlockOverlap,
  hasCubeColorConflict,
  hasPipeColorConflict,
  hasYCubePipeAxisConflict,
  isValidPos,
  isPipeType,
  resolvePipeType,
  posKey,
  axisIndex,
} from "../types";
import type { CubeType, Position3D, ViewMode } from "../types";
import { cameraGroundPoint } from "../utils/groundPlane";
import { snapIsoPos, isoGridMeshTransform } from "../utils/isoView";

const PLANE_SIZE = 1000;

/** Snap a Three.js world point to a valid TQEC position based on view mode. */
function snapForViewMode(viewMode: ViewMode, point: THREE.Vector3, forPipe: boolean): Position3D {
  if (viewMode.kind === "iso") return snapIsoPos(viewMode, point, forPipe, snapInPlane);
  return snapGroundPos(point.x, -point.z, forPipe);
}

export function GridPlane() {
  const addBlock = useBlockStore((s) => s.addBlock);
  const mode = useBlockStore((s) => s.mode);
  const viewMode = useBlockStore((s) => s.viewMode);
  const setHoveredGridPos = useBlockStore((s) => s.setHoveredGridPos);
  const meshRef = useRef<THREE.Mesh>(null!);
  const target = useRef(new THREE.Vector3());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useThree((s) => s.controls) as any;

  // Keep the invisible raycast plane centered: under the camera in persp mode,
  // following the orbit target along the in-plane axes in iso mode.
  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (viewMode.kind === "persp") {
      if (cameraGroundPoint(camera, target.current)) {
        mesh.position.set(Math.round(target.current.x), 0, Math.round(target.current.z));
      }
      return;
    }
    const ot: THREE.Vector3 | undefined = controls?.target;
    const slice = viewMode.slice;
    if (viewMode.axis === "x") {
      mesh.position.set(slice, ot ? Math.round(ot.y) : 0, ot ? Math.round(ot.z) : 0);
    } else if (viewMode.axis === "y") {
      mesh.position.set(ot ? Math.round(ot.x) : 0, ot ? Math.round(ot.y) : 0, -slice);
    } else {
      mesh.position.set(ot ? Math.round(ot.x) : 0, slice, ot ? Math.round(ot.z) : 0);
    }
  });

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (mode !== "edit") { setHoveredGridPos(null); return; }

    const store = useBlockStore.getState();
    // No grid-plane preview when nothing is armed, or while X-held delete is active.
    if (store.xHeld || store.armedTool === "pointer") {
      setHoveredGridPos(null);
      return;
    }
    // Port tool: snap to the nearest cube slot for hover preview. The dedicated
    // PortPlacementGhost (OpenPipeGhosts.tsx) reads hoveredGridPos and renders a
    // ghost cube at empty slots.
    if (store.armedTool === "port") {
      const pos = snapGroundPos(e.point.x, -e.point.z, false);
      const key = posKey(pos);
      if (store.blocks.has(key) || store.portPositions.has(key)) {
        setHoveredGridPos(null);
      } else {
        setHoveredGridPos(pos);
      }
      return;
    }
    const forPipe = store.pipeVariant !== null;
    const pos = snapForViewMode(viewMode, e.point, forPipe);

    // Determine actual block type for this position
    let blockType = store.cubeType;
    if (store.pipeVariant) {
      const resolved = resolvePipeType(store.pipeVariant, pos);
      if (!resolved) { setHoveredGridPos(pos, undefined, true); return; }
      blockType = resolved;
    }

    const existing = store.blocks.get(posKey(pos));
    const existingKey = existing ? posKey(pos) : undefined;
    const isReplace = !!(existing && existing.type !== blockType);
    if (!isValidPos(pos, blockType) || hasBlockOverlap(pos, blockType, store.blocks, store.spatialIndex, existingKey)) {
      setHoveredGridPos(pos, blockType, true, undefined, isReplace);
    } else if (existing && existing.type === blockType) {
      setHoveredGridPos(null);
    } else if (!store.freeBuild && isPipeType(blockType) && hasPipeColorConflict(blockType, pos, store.blocks)) {
      setHoveredGridPos(pos, blockType, true, "Pipe colors don't match the adjacent cube", isReplace);
    } else if (!store.freeBuild && !isPipeType(blockType) && blockType !== "Y" && hasCubeColorConflict(blockType as CubeType, pos, store.blocks)) {
      setHoveredGridPos(pos, blockType, true, "Cube colors don't match the adjacent pipe", isReplace);
    } else if (!store.freeBuild && hasYCubePipeAxisConflict(blockType, pos, store.blocks)) {
      setHoveredGridPos(pos, blockType, true, "Y cube cannot be next to an X-open or Y-open pipe", isReplace);
    } else {
      setHoveredGridPos(pos, blockType, false, undefined, isReplace);
    }
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 2) return; // ignore drags
    if (mode !== "edit") return;

    const store = useBlockStore.getState();
    // X-held delete on empty grid is a no-op.
    if (store.xHeld) return;
    if (store.armedTool === "pointer") {
      store.clearSelection();
      return;
    }
    // Port tool: place an explicit port marker at the snapped cube position.
    if (store.armedTool === "port") {
      const pos = snapGroundPos(e.point.x, -e.point.z, false);
      store.addPortAt(pos);
      return;
    }
    const forPipe = store.pipeVariant !== null;
    const pos = snapForViewMode(viewMode, e.point, forPipe);
    addBlock(pos);
  };

  const handlePointerLeave = () => {
    setHoveredGridPos(null);
  };

  // Mesh orientation matches the active plane: floor in persp, slice plane in iso.
  const rotation: [number, number, number] = viewMode.kind === "persp"
    ? [-Math.PI / 2, 0, 0]
    : isoGridMeshTransform(viewMode.axis).rotation;

  if (mode === "build") {
    return (
      <mesh
        ref={meshRef}
        rotation={rotation}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta > 2) return;
          // Build mode places cubes; always snap to block positions (forPipe=false).
          const pos = snapForViewMode(viewMode, e.point, false);
          // For build we ignore the slice constraint on Z if needed; honor depth from snap.
          // But ensure depth axis lands on a block coord.
          const adjusted = enforceBlockDepth(viewMode, pos);
          useBlockStore.getState().moveBuildCursor(adjusted);
        }}
        onPointerLeave={handlePointerLeave}
      >
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
      </mesh>
    );
  }

  return (
    <mesh
      ref={meshRef}
      rotation={rotation}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
      onPointerLeave={handlePointerLeave}
    >
      <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
      <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Force the depth coord to a multiple of 3 (build cursor must land on a cube position). */
function enforceBlockDepth(viewMode: ViewMode, pos: Position3D): Position3D {
  if (viewMode.kind !== "iso") return pos;
  const idx = axisIndex(viewMode.axis);
  const coords = [pos.x, pos.y, pos.z];
  coords[idx] = Math.round(coords[idx] / 3) * 3;
  return { x: coords[0], y: coords[1], z: coords[2] };
}
