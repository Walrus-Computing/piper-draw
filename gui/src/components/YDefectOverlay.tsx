import { useMemo } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import {
  createYDefectCylinderGroup,
  posKey,
  tqecToThree,
  yBlockZOffset,
  Y_DEFECT_HEX,
} from "../types";
import type { BlockType, FaceMask } from "../types";

const yDefectMaterial = new THREE.MeshLambertMaterial({ color: Y_DEFECT_HEX });

type CylinderInstance = {
  geometry: THREE.CylinderGeometry;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

const templateCache = new Map<string, CylinderInstance[]>();

function getCachedTemplate(blockType: BlockType, hiddenFaces: FaceMask): CylinderInstance[] {
  const key = `${blockType}:${hiddenFaces}`;
  let arr = templateCache.get(key);
  if (!arr) {
    const group = createYDefectCylinderGroup(blockType, hiddenFaces, yDefectMaterial);
    arr = group.children.map((child) => {
      const mesh = child as THREE.Mesh;
      return {
        geometry: mesh.geometry as THREE.CylinderGeometry,
        position: mesh.position.clone(),
        quaternion: mesh.quaternion.clone(),
      };
    });
    templateCache.set(key, arr);
  }
  return arr;
}

export function YDefectOverlay() {
  const blocks = useBlockStore((s) => s.blocks);
  const hiddenFaces = useBlockStore((s) => s.hiddenFaces);
  const showYDefects = useBlockStore((s) => s.showYDefects);

  const items = useMemo(() => {
    if (!showYDefects) return [];
    const out: Array<{
      key: string;
      worldPos: [number, number, number];
      cylinders: CylinderInstance[];
    }> = [];
    for (const block of blocks.values()) {
      const k = posKey(block.pos);
      const hf = hiddenFaces.get(k) ?? 0;
      const cylinders = getCachedTemplate(block.type, hf);
      if (cylinders.length === 0) continue;
      const zo = block.type === "Y" ? yBlockZOffset(block.pos, blocks) : 0;
      out.push({ key: k, worldPos: tqecToThree(block.pos, block.type, zo), cylinders });
    }
    return out;
  }, [blocks, hiddenFaces, showYDefects]);

  if (!showYDefects || items.length === 0) return null;

  return (
    <>
      {items.map(({ key, worldPos, cylinders }) => (
        <group key={key} position={worldPos}>
          {cylinders.map((c, i) => (
            <mesh
              key={i}
              geometry={c.geometry}
              material={yDefectMaterial}
              position={c.position}
              quaternion={c.quaternion}
            />
          ))}
        </group>
      ))}
    </>
  );
}
