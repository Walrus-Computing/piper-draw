// ---------------------------------------------------------------------------
// FileDropOverlay — mounts useFileDropHandler at the window level and renders
// the drag-active overlay. Owns the dispatch from dropped file → store.
// Design pick 2 (CEO plan): dragenter shows full-canvas overlay with dashed
// border + text "Drop .bgraph or .dae to load"; .json drops rejected.
//
// Lives in App.tsx as a single mount line; App.tsx grows by ~3 LOC.
// ---------------------------------------------------------------------------

import { useBlockStore } from "../stores/blockStore";
import { toastBus } from "../utils/toastBus";
import { useFileDropHandler } from "../hooks/useFileDropHandler";
import { daeImportSummaryMessage, parseDaeToBlocks } from "../utils/daeImport";
import { importBgraph } from "../utils/bgraphApi";
import { bgraphResponseToBlocks } from "../utils/bgraphImportToBlocks";
import { BgraphApiError } from "../types/bgraph";

function parseDroppedDae(text: string) {
  let summaryMessage: string | null = null;
  const blocks = parseDaeToBlocks(text, (summary) => {
    summaryMessage = daeImportSummaryMessage(summary);
  });
  return { blocks, summaryMessage };
}

export function FileDropOverlay() {
  const loadBlocks = useBlockStore((s) => s.loadBlocks);

  const { isDragging } = useFileDropHandler({
    onBgraph: async (text, filename) => {
      toastBus.info.emit(`Loading ${filename}…`);
      try {
        const resp = await importBgraph({ bgraph: text, mode: "load" });
        const { blocks, normalizedCount } = bgraphResponseToBlocks(resp);
        loadBlocks(blocks);
        if (normalizedCount > 0) {
          toastBus.info.emit(
            `Normalized ${normalizedCount} cube type${normalizedCount === 1 ? "" : "s"} per piper-draw canonicalization`,
          );
        }
        toastBus.info.emit(`Loaded ${filename} (${blocks.size} blocks).`);
      } catch (e) {
        if (e instanceof BgraphApiError) toastBus.error.emit(e.message);
        else
          toastBus.error.emit(
            `Couldn't import bgraph: ${e instanceof Error ? e.message : String(e)}`,
          );
      }
    },
    onDae: (text, filename) => {
      try {
        const { blocks, summaryMessage } = parseDroppedDae(text);
        loadBlocks(blocks);
        toastBus.info.emit(`Loaded ${filename} (${blocks.size} blocks).`);
        if (summaryMessage) toastBus.info.emit(summaryMessage);
      } catch (e) {
        toastBus.error.emit(
          `Couldn't import DAE: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    onUnsupportedExtension: (ext) => {
      toastBus.error.emit(`Unsupported file: ${ext}`);
    },
    onTooLarge: (filename) => {
      toastBus.error.emit(`${filename} exceeds the 5 MB cap.`);
    },
    onConcurrentDrop: () => {
      toastBus.info.emit("Already loading; this drop was ignored.");
    },
  });

  if (!isDragging) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 1800,
      }}
    >
      <div
        style={{
          width: "40vw",
          minWidth: 300,
          height: 200,
          border: "2px dashed #fff",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: 0.5,
        }}
      >
        Drop .bgraph or .dae to load
      </div>
    </div>
  );
}
