// ---------------------------------------------------------------------------
// BgraphDialogs — single-mount host for the unified import modal and the
// examples gallery panel. Toolbar renders this once in the Import/Export
// column; the ImportMenu / ExportMenu dropdown items (<ImportSubmenu /> /
// <ExportSubmenu />) and the standalone "Examples" button share state through
// the BgraphActions object.
// ---------------------------------------------------------------------------

import { BgraphImportModal } from "./PasteBgraphModal";
import { BgraphGalleryPanel } from "./BgraphGalleryPanel";
import type { BgraphActions } from "../hooks/useBgraphActions";

export function BgraphDialogs({ actions }: { actions: BgraphActions }) {
  const {
    importModalOpen,
    importMode,
    setImportModalOpen,
    submitImport,
    examplesOpen,
    setExamplesOpen,
    loadExample,
  } = actions;
  return (
    <>
      <BgraphImportModal
        open={importModalOpen}
        mode={importMode}
        onClose={() => setImportModalOpen(false)}
        onSubmit={submitImport}
      />
      <BgraphGalleryPanel
        open={examplesOpen}
        onClose={() => setExamplesOpen(false)}
        onLoad={loadExample}
      />
    </>
  );
}
