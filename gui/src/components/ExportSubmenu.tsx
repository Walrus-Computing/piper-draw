// ---------------------------------------------------------------------------
// ExportSubmenu — side submenu opened from the File ▾ "Export ▸" button.
// Holds the .dae / .bgraph / standalone-.html export buttons plus the dev-only
// round-trip verifier (tree-shaken from production builds).
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useBlockStore } from "../stores/blockStore";
import { downloadDae } from "../utils/daeExport";
import { captureSnapshot } from "../utils/sceneSnapshot";
import { buildViewSnapshot, captureCameraState } from "../utils/viewSnapshot";
import type { ViewSnapshotV1 } from "../utils/viewSnapshot";
import { exportStandaloneHtml, iframeSnippet } from "../utils/htmlExport";
import { RoundTripVerifyButton } from "./RoundTripVerifyButton";
import { EmbedSnippetPanel } from "./EmbedSnippetPanel";
import type { BgraphActions } from "../hooks/useBgraphActions";

const HTML_FILENAME = "pipe-diagram.html";
const SCENE_BACKGROUND = "#CBDFC6";

/** Capture the current scene + flow/view + camera as a frozen view snapshot. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function currentViewSnapshot(controls: any): ViewSnapshotV1 {
  const s = useBlockStore.getState();
  const selectedFlow =
    s.flowVizMode && s.selectedFlowIndex !== null && s.selectedFlowIndex >= 0
      ? s.flows[s.selectedFlowIndex] ?? null
      : null;
  return buildViewSnapshot({
    scene: captureSnapshot(),
    flowVizMode: s.flowVizMode,
    selectedFlow,
    viewMode: s.viewMode,
    // null when controls aren't mounted → the viewer auto-fits the scene.
    camera: captureCameraState(controls),
    showGrid: false,
    background: SCENE_BACKGROUND,
  });
}

interface Props {
  itemStyle: React.CSSProperties;
  itemStyleDisabled: React.CSSProperties;
  blocksEmpty: boolean;
  onItemClick: () => void;
  bgraph: BgraphActions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlsRef: React.RefObject<any>;
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
  controlsRef,
}: Props) {
  const [snippet, setSnippet] = useState<string | null>(null);

  async function handleHtmlExport() {
    try {
      const view = currentViewSnapshot(controlsRef.current);
      const savedName = await exportStandaloneHtml(view, HTML_FILENAME);
      if (savedName) setSnippet(iframeSnippet(savedName));
    } catch (err) {
      console.error("Standalone HTML export failed", err);
      window.alert(err instanceof Error ? err.message : "Export failed");
    }
  }

  const btnStyle = blocksEmpty ? itemStyleDisabled : itemStyle;
  return (
    <div style={SUBMENU_STYLE}>
      <button
        style={btnStyle}
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
        style={btnStyle}
        disabled={blocksEmpty}
        title="Export current scene as .bgraph (TQEC text format)"
        onClick={() => void bgraph.exportScene()}
      >
        Export .bgraph
      </button>
      <button
        style={btnStyle}
        disabled={blocksEmpty}
        title="Export an interactive, self-contained .html of the current view (for embedding)"
        onClick={() => void handleHtmlExport()}
      >
        Export standalone .html
      </button>
      {snippet && <EmbedSnippetPanel key={snippet} snippet={snippet} itemStyle={itemStyle} />}
      <RoundTripVerifyButton itemStyle={itemStyle} onClick={onItemClick} />
    </div>
  );
}
