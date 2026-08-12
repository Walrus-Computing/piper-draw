// ---------------------------------------------------------------------------
// Dev-only round-trip verifier. Renders ONLY when `import.meta.env.DEV` is true
// (CEO plan E5). User will remove before merging — this is self-contained in
// one file plus a single mount line in BgraphMenuItems.
//
// Action: serialize current scene → POST /api/bgraph_export → POST /api/bgraph_import
// → diff against original Map → surface diff via toast + console.
//
// NOT a regression-test surface; just an interactive sanity check during
// development.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useBlockStore } from "../stores/blockStore";
import { toastBus } from "../utils/toastBus";
import { exportBgraph, importBgraph } from "../utils/bgraphApi";
import type { BgraphPortLabelInput } from "../types/bgraph";

interface Props {
  itemStyle: React.CSSProperties;
  onClick?: () => void;
}

export function RoundTripVerifyButton({ itemStyle, onClick }: Props) {
  const [busy, setBusy] = useState(false);

  // Hard gate: only render in dev builds. Vite replaces import.meta.env.DEV at
  // build time, so production bundles see `false` and tree-shake this branch.
  if (!import.meta.env.DEV) return null;

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blocks = useBlockStore.getState().blocks;
      const portMeta = useBlockStore.getState().portMeta;
      const portLabels: BgraphPortLabelInput[] = [];
      for (const [key, meta] of portMeta) {
        const [x, y, z] = key.split(",").map(Number);
        portLabels.push({ pos: [x, y, z], label: meta.label });
      }
      const exp = await exportBgraph({ blocks, portLabels });
      const imp = await importBgraph({ bgraph: exp.bgraph, mode: "load" });

      // Compare: every original block should reappear after round-trip.
      const original = new Set<string>();
      for (const b of blocks.values()) {
        original.add(`${b.pos.x},${b.pos.y},${b.pos.z}:${b.type}`);
      }
      const roundtripped = new Set<string>();
      for (const b of imp.blocks) {
        roundtripped.add(`${b.pos[0]},${b.pos[1]},${b.pos[2]}:${b.type}`);
      }
      const lost = [...original].filter((k) => !roundtripped.has(k));
      const gained = [...roundtripped].filter((k) => !original.has(k));

      const report = {
        original: original.size,
        roundtripped: roundtripped.size,
        lost,
        gained,
      };
      console.log("[round-trip verify]", report);
      if (lost.length === 0 && gained.length === 0) {
        toastBus.info.emit(`Round-trip OK: ${original.size} blocks preserved.`);
      } else {
        toastBus.error.emit(
          `Round-trip drift: lost=${lost.length} gained=${gained.length}. See console.`,
        );
      }
    } catch (e) {
      toastBus.error.emit(
        `Round-trip verify failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
      onClick?.();
    }
  };

  return (
    <button
      onClick={() => void handleClick()}
      style={itemStyle}
      disabled={busy}
      title="DEV: export current scene as bgraph, re-import, diff. Removable before merge."
    >
      {busy ? "Verifying…" : "Verify bgraph round-trip (dev)"}
    </button>
  );
}
