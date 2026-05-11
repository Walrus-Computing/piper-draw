// ---------------------------------------------------------------------------
// ExportSubmenu — side submenu opened from the File ▾ "Export ▸" button.
// Holds the .dae and .bgraph export buttons plus the dev-only round-trip
// verifier (tree-shaken from production builds).
// ---------------------------------------------------------------------------

import { useBlockStore } from "../stores/blockStore";
import { downloadDae } from "../utils/daeExport";
import { RoundTripVerifyButton } from "./RoundTripVerifyButton";
import type { BgraphActions } from "../hooks/useBgraphActions";

interface Props {
  itemStyle: React.CSSProperties;
  itemStyleDisabled: React.CSSProperties;
  blocksEmpty: boolean;
  onItemClick: () => void;
  bgraph: BgraphActions;
}

const SUBMENU_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: "100%",
  marginLeft: 4,
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  padding: 4,
  minWidth: 180,
  zIndex: 1001,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

export function ExportSubmenu({
  itemStyle,
  itemStyleDisabled,
  blocksEmpty,
  onItemClick,
  bgraph,
}: Props) {
  return (
    <div style={SUBMENU_STYLE}>
      <button
        style={blocksEmpty ? itemStyleDisabled : itemStyle}
        disabled={blocksEmpty}
        title="Export current scene as .dae (Collada)"
        onClick={() => {
          downloadDae(useBlockStore.getState().blocks);
          onItemClick();
        }}
      >
        Export .dae
      </button>
      <button
        style={blocksEmpty ? itemStyleDisabled : itemStyle}
        disabled={blocksEmpty}
        title="Export current scene as .bgraph (TQEC text format)"
        onClick={() => void bgraph.exportScene()}
      >
        Export .bgraph
      </button>
      <RoundTripVerifyButton itemStyle={itemStyle} onClick={onItemClick} />
    </div>
  );
}
