import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import {
  tqecToThree,
  yBlockZOffset,
  getHiddenFaceMaskForPos,
  isPipeType,
  pipeAxisFromPos,
  axisIndex,
  CUBE_TYPES,
} from "../types";
import { isoTopThreeAxis } from "../utils/isoFoldOut";
import type { ThreeAxis } from "../utils/isoFoldOut";
import { getCachedGeometry, getCachedEdges, getCachedFullBox } from "./BlockInstances";
import { FoldOutCubeFaces } from "./FoldOutCube";

const noRaycast = () => {};

// Shared materials — allocated once, never re-created
const ghostMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const portGhostMaterial = new THREE.MeshBasicMaterial({
  color: 0xdddddd,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const portGhostBox = new THREE.BoxGeometry(1, 1, 1);
const portGhostEdges = new THREE.EdgesGeometry(portGhostBox);
const invalidMaterial = new THREE.MeshLambertMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const deleteMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const validLineMaterial = new THREE.LineBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});
const invalidLineMaterial = new THREE.LineBasicMaterial({
  color: "#ff0000",
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});
const replaceMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const replaceLineMaterial = new THREE.LineBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
});
// Iso-mode ghost for non-cube types (pipes, Y): opaque colored mesh + full-opacity
// black edges, matching the toolbar preview style. Cube ghosts use the fold-out
// instead so they don't go through these.
const isoGhostMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const isoLineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
// Iso-mode overlay for depth-axis pipe ghosts: draws the pipe's full extent on top
// of any occluding geometry so the user can tell where the pipe goes (the cap alone
// looks identical to a cube cap when seen end-on).
const depthPipeOutlineMaterial = new THREE.LineBasicMaterial({
  color: "#1f6feb",
  transparent: true,
  opacity: 0.55,
  depthTest: false,
  depthWrite: false,
});

/**
 * Inner component — only mounts when hoveredGridPos is non-null.
 * Subscribes to blocks/spatialIndex for hidden-face computation.
 */
function GhostBlockInner() {
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos)!;
  const mode = useBlockStore((s) => s.mode);
  const cubeType = useBlockStore((s) => s.cubeType);
  const hoveredBlockType = useBlockStore((s) => s.hoveredBlockType);
  const hoveredInvalid = useBlockStore((s) => s.hoveredInvalid);
  const hoveredReplace = useBlockStore((s) => s.hoveredReplace);
  const blocks = useBlockStore((s) => s.blocks);
  const spatialIndex = useBlockStore((s) => s.spatialIndex);
  const armedTool = useBlockStore((s) => s.armedTool);
  const xHeld = useBlockStore((s) => s.xHeld);
  const viewMode = useBlockStore((s) => s.viewMode);

  // Port placement preview: render a port-style white ghost at the snapped
  // cube position. No type-dependent coloring, no hidden-face mask.
  if (armedTool === "port" && mode === "edit" && !xHeld) {
    const [x, y, z] = tqecToThree(hoveredGridPos, "XZZ");
    return (
      <group position={[x, y, z]}>
        <mesh raycast={noRaycast}>
          <primitive object={portGhostBox} attach="geometry" />
          <primitive object={portGhostMaterial} attach="material" />
        </mesh>
        <lineSegments raycast={noRaycast}>
          <primitive object={portGhostEdges} attach="geometry" />
          <primitive object={validLineMaterial} attach="material" />
        </lineSegments>
      </group>
    );
  }

  const activeType = hoveredBlockType ?? cubeType;

  const previewHiddenFaces = getHiddenFaceMaskForPos(hoveredGridPos, activeType, blocks, spatialIndex);
  const ghostGeometry = getCachedGeometry(activeType, previewHiddenFaces);
  const ghostEdges = getCachedEdges(activeType, previewHiddenFaces);

  const zo = activeType === "Y" ? yBlockZOffset(hoveredGridPos, blocks) : 0;
  const [x, y, z] = tqecToThree(hoveredGridPos, activeType, zo);
  const isDelete = xHeld && mode === "edit";
  const isInvalid = !isDelete && hoveredInvalid;
  const isReplace = !isDelete && hoveredReplace;

  const isIso = viewMode.kind === "iso";
  let meshMat: THREE.Material = isInvalid
    ? invalidMaterial
    : isIso
      ? isoGhostMaterial
      : ghostMaterial;
  let lineMat: THREE.Material = isInvalid
    ? invalidLineMaterial
    : isIso
      ? isoLineMaterial
      : validLineMaterial;
  let scale = isInvalid ? 1.005 : 1;
  if (isReplace && !isInvalid) {
    meshMat = replaceMaterial;
    lineMat = replaceLineMaterial;
    scale = 1.01;
  }

  // In iso mode, a pipe whose open axis matches the view's depth axis collapses end-on
  // to a unit cap (visually identical to a cube). Render the full pipe edges with
  // depthTest off so the user can see the pipe is there even if a cube occludes it.
  const pipeAxis = isPipeType(activeType) ? pipeAxisFromPos(hoveredGridPos) : null;
  const showDepthPipeOutline =
    !isDelete &&
    viewMode.kind === "iso" &&
    pipeAxis !== null &&
    pipeAxis === axisIndex(viewMode.axis);
  const fullPipeEdges = showDepthPipeOutline ? getCachedEdges(activeType, 0) : null;

  // Iso-mode cube preview: fan the 4 side faces outward so their colors are visible.
  const showFoldOutCube =
    !isDelete &&
    !isInvalid &&
    viewMode.kind === "iso" &&
    (CUBE_TYPES as readonly string[]).includes(activeType);
  const foldTopAxis: ThreeAxis = viewMode.kind === "iso" ? isoTopThreeAxis(viewMode.axis) : 0;

  return (
    <group position={[x, y, z]}>
      {isDelete ? (
        <mesh scale={1.01} raycast={noRaycast}>
          <primitive object={getCachedFullBox(activeType)} attach="geometry" />
          <primitive object={deleteMaterial} attach="material" />
        </mesh>
      ) : (
        <group scale={scale}>
          {!showFoldOutCube && (
            <>
              <mesh>
                <primitive object={ghostGeometry} attach="geometry" />
                <primitive object={meshMat} attach="material" />
              </mesh>
              <lineSegments>
                <primitive object={ghostEdges} attach="geometry" />
                <primitive object={lineMat} attach="material" />
              </lineSegments>
            </>
          )}
          {fullPipeEdges && (
            <lineSegments scale={1.04} renderOrder={999}>
              <primitive object={fullPipeEdges} attach="geometry" />
              <primitive object={depthPipeOutlineMaterial} attach="material" />
            </lineSegments>
          )}
          {showFoldOutCube && (
            <FoldOutCubeFaces blockType={activeType} topAxis={foldTopAxis} />
          )}
        </group>
      )}
    </group>
  );
}

/**
 * Outer component — only subscribes to hoveredGridPos.
 * When null, renders nothing and avoids subscribing to blocks/spatialIndex.
 */
export function GhostBlock() {
  const hasHover = useBlockStore((s) => s.hoveredGridPos !== null);
  const mode = useBlockStore((s) => s.mode);
  const armedTool = useBlockStore((s) => s.armedTool);
  const xHeld = useBlockStore((s) => s.xHeld);
  if (!hasHover || mode === "build") return null;
  // In Drag / Drop mode, only show a ghost when a placement tool is armed (or X-held
  // delete preview). Pointer mode has no ghost — hover just highlights. Paste
  // mode renders its own multi-block PasteGhost instead.
  if (mode === "edit" && !xHeld && (armedTool === "pointer" || armedTool === "paste")) return null;
  return <GhostBlockInner />;
}
