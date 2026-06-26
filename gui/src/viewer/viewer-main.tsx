import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";

// Match the editor's color pipeline (App.tsx) so embedded colors are identical.
THREE.ColorManagement.enabled = false;

import { useBlockStore } from "../stores/blockStore";
import { applySnapshot } from "../utils/sceneSnapshot";
import { isViewSnapshotV1 } from "../utils/viewSnapshot";
import type { ViewSnapshotV1 } from "../utils/viewSnapshot";
import { ViewerScene, EmptyMessage } from "./ViewerScene";

declare global {
  interface Window {
    __PIPER_VIEW__?: unknown;
  }
}

/** Load the frozen scene + flow/view state into the shared store. */
function hydrate(view: ViewSnapshotV1): void {
  applySnapshot(view.scene, "hydrate");
  useBlockStore.setState({
    flowVizMode: view.flowVizMode,
    flows: view.selectedFlow ? [view.selectedFlow] : [],
    selectedFlowIndex: view.selectedFlow ? 0 : null,
    viewMode: view.viewMode,
  });
}

const container = document.getElementById("viewer-root")!;
const root = createRoot(container);
const data = window.__PIPER_VIEW__;

if (isViewSnapshotV1(data)) {
  hydrate(data);
  root.render(
    <StrictMode>
      <ViewerScene view={data} />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <EmptyMessage />
    </StrictMode>,
  );
}
