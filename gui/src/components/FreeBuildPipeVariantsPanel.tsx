import { useMemo } from "react";
import { useBlockStore } from "../stores/blockStore";
import {
  FACE_CONFIGS,
  X_HEX,
  Y_DEFECT_HEX,
  Z_HEX,
  faceAboveBasis,
  faceBelowBasis,
  isFreeBuildPipeSpec,
  validFBPipeVariantsXZZXAxis,
} from "../types";
import type { FaceConfig } from "../types";
import { useFloatingPanel } from "../hooks/useFloatingPanel";
import { ResizeGrip } from "../hooks/ResizeGrip";

const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 260;

const COLOR_FOR: Record<"X" | "Z", string> = { X: X_HEX, Z: Z_HEX };

const CELL_W = 56;
const CELL_H = 36;
// Face order matches FreeBuildPipeSpec.faces: [+ca0, −ca0, +ca1, −ca1].
const FACE_LABELS = ["+a", "−a", "+b", "−b"] as const;

function VariantSprite({ faces, size = 1 }: { faces: readonly FaceConfig[]; size?: number }) {
  // 4 walls × (below, above) strips. Layout: vertical stack of 4 rows, each
  // row is two halves (left = below, right = above). A magenta divider sits
  // between the halves on swapping faces (XZ/ZX), echoing the Y-defect ring.
  const rowH = (CELL_H * size) / 4;
  const halfW = (CELL_W * size) / 2;
  return (
    <svg
      width={CELL_W * size}
      height={CELL_H * size}
      viewBox={`0 0 ${CELL_W * size} ${CELL_H * size}`}
      shapeRendering="crispEdges"
    >
      {faces.map((fc, i) => {
        const y = i * rowH;
        const below = COLOR_FOR[faceBelowBasis(fc)];
        const above = COLOR_FOR[faceAboveBasis(fc)];
        const swap = fc === "XZ" || fc === "ZX";
        return (
          <g key={i}>
            <rect x={0} y={y} width={halfW} height={rowH} fill={below} />
            <rect x={halfW} y={y} width={halfW} height={rowH} fill={above} />
            {swap && (
              <line
                x1={halfW}
                y1={y}
                x2={halfW}
                y2={y + rowH}
                stroke={Y_DEFECT_HEX}
                strokeWidth={2}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function facesEqual(
  a: readonly FaceConfig[],
  b: readonly FaceConfig[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Enumerate every (face0, face1, face2, face3) ∈ FACE_CONFIGS⁴. */
function enumerateVariants(): Array<[FaceConfig, FaceConfig, FaceConfig, FaceConfig]> {
  const out: Array<[FaceConfig, FaceConfig, FaceConfig, FaceConfig]> = [];
  for (const f0 of FACE_CONFIGS) {
    for (const f1 of FACE_CONFIGS) {
      for (const f2 of FACE_CONFIGS) {
        for (const f3 of FACE_CONFIGS) {
          out.push([f0, f1, f2, f3]);
        }
      }
    }
  }
  return out;
}

export function FreeBuildPipeVariantsPanel() {
  const fbPos = useBlockStore((s) => s.fbVariantsPos);
  const blocks = useBlockStore((s) => s.blocks);
  const setFBVariantsPos = useBlockStore((s) => s.setFBVariantsPos);
  const setFBPipeFaces = useBlockStore((s) => s.setFBPipeFaces);

  const block = fbPos ? blocks.get(fbPos) : null;
  const open = !!(block && isFreeBuildPipeSpec(block.type));

  const {
    containerStyle,
    dragHandleProps,
    resizeGripProps,
  } = useFloatingPanel({
    id: "fb-variants",
    defaultGeometry: {
      x: typeof window !== "undefined" ? window.innerWidth - 360 : 10,
      y: 70,
      width: 340,
      height: 460,
    },
    minWidth: PANEL_MIN_WIDTH,
    minHeight: PANEL_MIN_HEIGHT,
  });

  const variants = useMemo(() => enumerateVariants(), []);

  const partitioned = useMemo(() => {
    if (!block) return null;
    const valid = validFBPipeVariantsXZZXAxis(block, blocks);
    if (!valid) return null;
    const validKeys = new Set(valid.map((v) => v.join("|")));
    const validList: typeof variants = [];
    const invalidList: typeof variants = [];
    for (const v of variants) {
      if (validKeys.has(v.join("|"))) validList.push(v);
      else invalidList.push(v);
    }
    return { validList, invalidList };
  }, [block, blocks, variants]);

  if (!open || !block || !isFreeBuildPipeSpec(block.type)) return null;
  const currentFaces = block.type.faces;

  const renderCell = (faces: [FaceConfig, FaceConfig, FaceConfig, FaceConfig]) => {
    const isCurrent = facesEqual(faces, currentFaces);
    const key = faces.join("|");
    return (
      <button
        key={key}
        type="button"
        onClick={() => setFBPipeFaces(block.pos, faces)}
        title={faces.join(" ")}
        style={{
          padding: 4,
          background: isCurrent ? "#e8f1ff" : "#fafafa",
          border: `1px solid ${isCurrent ? "#4a9eff" : "#e0e0e0"}`,
          borderRadius: 4,
          cursor: "pointer",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <VariantSprite faces={faces} />
      </button>
    );
  };

  const sectionHeaderStyle = {
    gridColumn: "1 / -1",
    color: "#666",
    fontSize: 11,
    fontWeight: 600,
    padding: "4px 2px 2px",
  } as const;

  return (
    <div
      style={{
        ...containerStyle,
        zIndex: 50,
        background: "#fff",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "sans-serif",
        fontSize: 12,
        color: "#222",
        overflow: "hidden",
      }}
    >
      <header
        {...dragHandleProps}
        style={{
          ...dragHandleProps.style,
          padding: "10px 12px",
          borderBottom: "1px solid #eee",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>Free Pipe variants</span>
        <button
          onClick={() => setFBVariantsPos(null)}
          aria-label="Close FB variants panel"
          style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#666", padding: "0 4px" }}
        >
          ✕
        </button>
      </header>

      <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "#666" }}>Current</span>
        <VariantSprite faces={currentFaces} size={1.2} />
        <span style={{ color: "#888", fontFamily: "monospace" }}>{currentFaces.join(" ")}</span>
      </div>

      <div style={{ padding: "8px 12px", color: "#666", fontSize: 11, borderBottom: "1px solid #eee" }}>
        Rows top→bottom: {FACE_LABELS.join(", ")}. Left half = below defect, right half = above.
      </div>

      <div
        style={{
          padding: 8,
          flex: 1,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${CELL_W + 12}px, 1fr))`,
          gap: 6,
        }}
      >
        {partitioned ? (
          <>
            <div style={sectionHeaderStyle}>Valid for XZZ–XZZ in X</div>
            {partitioned.validList.map(renderCell)}
            <div
              style={{
                ...sectionHeaderStyle,
                borderTop: "1px solid #eee",
                marginTop: 6,
                paddingTop: 8,
              }}
            >
              Other variants (not valid for XZZ–XZZ in X)
            </div>
            {partitioned.invalidList.map(renderCell)}
          </>
        ) : (
          variants.map(renderCell)
        )}
      </div>

      <ResizeGrip {...resizeGripProps} />
    </div>
  );
}
