// ---------------------------------------------------------------------------
// ImportSubmenu — dropdown body for the top-level "Import ▾" toolbar button.
// Holds all open-a-scene operations: .dae file pickers and the unified bgraph
// modal (file or paste, load or insert). The examples gallery has its own
// top-level toolbar button ("Examples").
// ---------------------------------------------------------------------------

import type { Block } from "../types";
import { triggerDaeImport } from "../utils/daeImport";
import type { BgraphActions } from "../hooks/useBgraphActions";

interface Props {
  itemStyle: React.CSSProperties;
  onItemClick: () => void;
  loadBlocks: (blocks: Map<string, Block>) => void;
  insertBlocks: (blocks: Map<string, Block>) => void;
  bgraph: BgraphActions;
}

const SUBMENU_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
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

export function ImportSubmenu({
  itemStyle,
  onItemClick,
  loadBlocks,
  insertBlocks,
  bgraph,
}: Props) {
  const close = onItemClick;
  return (
    <div style={SUBMENU_STYLE}>
      <button
        style={itemStyle}
        title="Load a .dae file (replaces current scene)"
        onClick={() => {
          triggerDaeImport(loadBlocks);
          close();
        }}
      >
        Load .dae…
      </button>
      <button
        style={itemStyle}
        title="Insert a .dae file next to current scene; inserted blocks stay selected"
        onClick={() => {
          triggerDaeImport(insertBlocks);
          close();
        }}
      >
        Insert .dae…
      </button>
      <div style={{ height: 1, background: "#eee", margin: "2px 0" }} />
      <button
        style={itemStyle}
        title="Open a .bgraph file or paste a bgraph string (replaces current scene)"
        onClick={() => bgraph.openImportModal("load")}
      >
        Load bgraph…
      </button>
      <button
        style={itemStyle}
        title="Open a .bgraph file or paste a bgraph string (adds to current scene)"
        onClick={() => bgraph.openImportModal("insert")}
      >
        Insert bgraph…
      </button>
    </div>
  );
}
