import { useMemo } from "react";
import { Text } from "@react-three/drei";
import { useBlockStore } from "../stores/blockStore";
import { getAllPortPositions, posKey, tqecToThree } from "../types";

const IO_COLOR: Record<string, string> = {
  in: "#1a7f37",
  out: "#b00020",
};

export function PortLabels3D() {
  const blocks = useBlockStore((s) => s.blocks);
  const portPositions = useBlockStore((s) => s.portPositions);
  const portMeta = useBlockStore((s) => s.portMeta);

  const entries = useMemo(() => {
    const positions = getAllPortPositions(blocks, portPositions);
    return positions.map((pos) => {
      const key = posKey(pos);
      const meta = portMeta.get(key);
      const threePos = tqecToThree(pos, "XZZ") as [number, number, number];
      return { key, meta, threePos };
    });
  }, [blocks, portPositions, portMeta]);

  return (
    <>
      {entries.map(({ key, meta, threePos }) =>
        meta ? (
          <Text
            key={key}
            position={threePos}
            fontSize={0.3}
            color={IO_COLOR[meta.io] ?? "#333"}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.015}
            outlineColor="#fff"
            depthOffset={-1}
            renderOrder={10}
          >
            {meta.label}
          </Text>
        ) : null,
      )}
    </>
  );
}
