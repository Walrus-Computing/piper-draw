// ---------------------------------------------------------------------------
// ExportSubmenu — the .dae and .bgraph export buttons plus the dev-only
// round-trip verifier (tree-shaken from production builds). Rendered inline
// as list items directly inside the "Export ▾" toolbar dropdown.
// ---------------------------------------------------------------------------

import { useBlockStore } from "../stores/blockStore";
import { useExportHtmlStore } from "../stores/exportHtmlStore";
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

export function ExportSubmenu({
  itemStyle,
  itemStyleDisabled,
  blocksEmpty,
  onItemClick,
  bgraph,
}: Props) {
  return (
    <>
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
      <button
        style={blocksEmpty ? itemStyleDisabled : itemStyle}
        disabled={blocksEmpty}
        title="Export current scene as an embeddable HTML iframe"
        onClick={() => {
          useExportHtmlStore.getState().openModal();
          onItemClick();
        }}
      >
        Export HTML
      </button>
      <RoundTripVerifyButton itemStyle={itemStyle} onClick={onItemClick} />
    </>
  );
}
