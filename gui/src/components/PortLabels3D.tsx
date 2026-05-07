import { useMemo } from "react";
import { Billboard, Text } from "@react-three/drei";
import { preloadFont } from "troika-three-text";
import { useBlockStore } from "../stores/blockStore";
import { getAllPortPositions, posKey, tqecToThree } from "../types";

// Warm troika's default font at module load so the first <Text> mount doesn't
// suspend the Canvas.
preloadFont({}, () => {});

const IO_COLOR: Record<string, string> = {
  in: "#1a7f37",
  out: "#b00020",
};

// Port cubes are 1×1×1; leave a small margin so the label never clips the edges.
const MAX_LABEL_EXTENT = 0.9;
// Approximate glyph width / fontSize ratio for the default drei Text font.
const CHAR_WIDTH_RATIO = 0.55;

function computeFontSize(label: string): number {
  const n = Math.max(1, label.length);
  const widthLimited = MAX_LABEL_EXTENT / (n * CHAR_WIDTH_RATIO);
  return Math.min(MAX_LABEL_EXTENT, widthLimited);
}

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
      {entries.map(({ key, meta, threePos }) => {
        if (!meta) return null;
        const fontSize = computeFontSize(meta.label);
        return (
          <Billboard key={key} position={threePos}>
            <Text
              fontSize={fontSize}
              color={IO_COLOR[meta.io] ?? "#333"}
              anchorX="center"
              anchorY="middle"
              outlineWidth={fontSize * 0.05}
              outlineColor="#fff"
              depthOffset={-1}
              renderOrder={10}
            >
              {meta.label}
            </Text>
          </Billboard>
        );
      })}
    </>
  );
}
