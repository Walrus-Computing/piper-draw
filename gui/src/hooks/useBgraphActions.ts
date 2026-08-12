// ---------------------------------------------------------------------------
// useBgraphActions — shared handlers + dialog state for the Import and Export
// menus. Lifted to a hook so Toolbar.tsx can render the bgraph-related items in
// separate places (the Import menu, the Export menu, and the standalone
// "Examples" button) while still sharing one import modal, one examples panel,
// and one set of handlers.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useBlockStore } from "../stores/blockStore";
import type { Block } from "../types";
import { toastBus } from "../utils/toastBus";
import { exportBgraph, importBgraph, downloadBgraph } from "../utils/bgraphApi";
import { bgraphResponseToBlocks } from "../utils/bgraphImportToBlocks";
import { BgraphApiError } from "../types/bgraph";
import type { BgraphPortLabelInput } from "../types/bgraph";
import type { ImportMode } from "../components/PasteBgraphModal";

interface Deps {
  loadBlocks: (blocks: Map<string, Block>) => void;
  insertBlocks: (blocks: Map<string, Block>) => void;
  onItemClick: () => void;
}

function collectPortLabels(): BgraphPortLabelInput[] {
  const portMeta = useBlockStore.getState().portMeta;
  const out: BgraphPortLabelInput[] = [];
  for (const [key, meta] of portMeta) {
    const [x, y, z] = key.split(",").map(Number);
    out.push({ pos: [x, y, z], label: meta.label, rank: meta.rank });
  }
  return out;
}

function reportError(e: unknown, contextLabel: string): void {
  if (e instanceof BgraphApiError) toastBus.error.emit(e.message);
  else
    toastBus.error.emit(
      `${contextLabel}: ${e instanceof Error ? e.message : String(e)}`,
    );
}

async function runImport(
  text: string,
  mode: ImportMode,
  loadBlocks: Deps["loadBlocks"],
  insertBlocks: Deps["insertBlocks"],
): Promise<void> {
  const resp = await importBgraph({ bgraph: text, mode });
  const { blocks, normalizedCount } = bgraphResponseToBlocks(resp);
  if (mode === "insert") insertBlocks(blocks);
  else loadBlocks(blocks);
  if (normalizedCount > 0) {
    const s = normalizedCount === 1 ? "" : "s";
    toastBus.info.emit(
      `Normalized ${normalizedCount} cube type${s} per piper-draw canonicalization`,
    );
  }
}

export function useBgraphActions({ loadBlocks, insertBlocks, onItemClick }: Deps) {
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("load");
  const [examplesOpen, setExamplesOpen] = useState(false);

  const openImportModal = (mode: ImportMode) => {
    setImportMode(mode);
    setImportModalOpen(true);
    onItemClick();
  };

  const submitImport = async (text: string, mode: ImportMode) => {
    try {
      await runImport(text, mode, loadBlocks, insertBlocks);
      setImportModalOpen(false);
    } catch (err) {
      if (err instanceof BgraphApiError) throw err;
      throw new Error(err instanceof Error ? err.message : String(err), { cause: err });
    }
  };

  const loadExample = async (text: string, name: string, mode: ImportMode) => {
    try {
      await runImport(text, mode, loadBlocks, insertBlocks);
      const verb = mode === "insert" ? "Inserted" : "Loaded";
      toastBus.info.emit(`${verb} example: ${name}`);
    } catch (err) {
      reportError(err, `Couldn't load example "${name}"`);
    }
  };

  const exportScene = async () => {
    onItemClick();
    const raw = window.prompt(
      "Circuit name? (saved to bgraph METADATA and used as the filename)",
      "scene",
    );
    if (raw === null) return;
    const sceneName = raw.trim() || "scene";
    try {
      const resp = await exportBgraph({
        blocks: useBlockStore.getState().blocks,
        portLabels: collectPortLabels(),
        sceneName,
      });
      const safeName =
        sceneName.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") ||
        "scene";
      downloadBgraph(resp.bgraph, safeName);
      toastBus.info.emit(`Exported "${sceneName}" as bgraph.`);
    } catch (err) {
      reportError(err, "Couldn't export bgraph");
    }
  };

  return {
    importModalOpen,
    importMode,
    setImportModalOpen,
    examplesOpen,
    setExamplesOpen,
    openImportModal,
    submitImport,
    loadExample,
    exportScene,
  };
}

export type BgraphActions = ReturnType<typeof useBgraphActions>;
