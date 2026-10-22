// ---------------------------------------------------------------------------
// ImportSubmenu — dropdown body for the top-level "Import ▾" toolbar button.
// Holds all open-a-scene operations: .dae file pickers and the unified bgraph
// modal (file or paste, load or insert). The examples gallery has its own
// top-level toolbar button ("Examples").
// ---------------------------------------------------------------------------

import type { Block } from "../types";
import { MENU_PANEL } from "./menuStyles";
import { triggerDaeImport } from "../utils/daeImport";
import type { BgraphActions } from "../hooks/useBgraphActions";

interface Props {
  itemStyle: React.CSSProperties;
  onItemClick: () => void;
  loadBlocks: (blocks: Map<string, Block>) => void;
  insertBlocks: (blocks: Map<string, Block>) => void;
  bgraph: BgraphActions;
}

const SUBMENU_STYLE: React.CSSProperties = { ...MENU_PANEL, minWidth: 180, zIndex: 1001 };

export function ImportSubmenu({
  itemStyle,
  onItemClick,
  loadBlocks,
  insertBlocks,
  bgraph,
}: Props) {
  const close = onItemClick;
  return (
    <div className="pd-menu" style={SUBMENU_STYLE}>
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
      <div style={{ height: 1, background: "var(--pd-rule-soft)", margin: "2px 0" }} />
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
