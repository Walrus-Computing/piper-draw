import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { tqecToThree, getHiddenFaceMaskForPos } from "../types";
import { getCachedGeometry, getCachedEdges, getCachedFullBox } from "./BlockInstances";

const noRaycast = () => {};

export function GhostBlock() {
  const hoveredGridPos = useBlockStore((s) => s.hoveredGridPos);
  const mode = useBlockStore((s) => s.mode);
  const cubeType = useBlockStore((s) => s.cubeType);
  const hoveredBlockType = useBlockStore((s) => s.hoveredBlockType);
  const hoveredInvalid = useBlockStore((s) => s.hoveredInvalid);
  const blocks = useBlockStore((s) => s.blocks);

  const activeType = hoveredBlockType ?? cubeType;

  const previewHiddenFaces = hoveredGridPos ? getHiddenFaceMaskForPos(hoveredGridPos, activeType, blocks) : 0;
  const ghostGeometry = getCachedGeometry(activeType, previewHiddenFaces);
  const ghostEdges = getCachedEdges(activeType, previewHiddenFaces);
  const ghostMaterial = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const invalidMaterial = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const deleteMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  if (!hoveredGridPos) return null;

  const [x, y, z] = tqecToThree(hoveredGridPos, activeType);
  const isDelete = mode === "delete";
  const isInvalid = !isDelete && hoveredInvalid;

  return (
    <group position={[x, y, z]}>
      {isDelete ? (
        <mesh scale={1.01} raycast={noRaycast}>
          <primitive object={getCachedFullBox(activeType)} attach="geometry" />
          <primitive object={deleteMaterial} attach="material" />
        </mesh>
      ) : (
        <group scale={isInvalid ? 1.005 : 1}>
          <mesh>
            <primitive object={ghostGeometry} attach="geometry" />
            <primitive object={isInvalid ? invalidMaterial : ghostMaterial} attach="material" />
          </mesh>
          <lineSegments>
            <primitive object={ghostEdges} attach="geometry" />
            <lineBasicMaterial color={isInvalid ? "#ff0000" : "#000000"} transparent opacity={0.4} depthWrite={false} />
          </lineSegments>
        </group>
      )}
    </group>
  );
}
