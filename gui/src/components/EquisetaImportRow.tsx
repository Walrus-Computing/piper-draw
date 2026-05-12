/**
 * Import / Insert action row for EquisetaJsonPanel.
 *
 * Renders the two buttons; delegates the actual dispatch to
 * `runEquisetaImport` in `utils/equisetaImportController.ts` so this file can
 * satisfy `react-refresh/only-export-components`.
 */

import type { FtqcGraph } from "../utils/equisetaJsonSchema";
import { runEquisetaImport } from "../utils/equisetaImportController";

export function EquisetaImportRow({
  graph,
  sourceLabel,
  disabled,
}: {
  graph: FtqcGraph;
  sourceLabel: string;
  disabled: boolean;
}) {
  const buttonStyle = (off: boolean): React.CSSProperties => ({
    padding: "4px 12px",
    fontSize: 12,
    border: "1px solid #b8c8e0",
    borderRadius: 3,
    background: off ? "#f0f3f8" : "#fff",
    color: off ? "#8a99b3" : "#1a4f9e",
    cursor: off ? "not-allowed" : "pointer",
    height: 24,
  });
  return (
    <div
      data-testid="import-action-row"
      style={{
        display: "flex",
        gap: 6,
        padding: "6px 10px",
        background: "#f4f7fc",
        borderBottom: "1px solid #e0e6f0",
      }}
    >
      <button
        data-testid="import-button"
        title={
          disabled
            ? "Wait for the current load to finish"
            : "Replace scene with imported blocks"
        }
        style={buttonStyle(disabled)}
        disabled={disabled}
        onClick={() => runEquisetaImport(graph, sourceLabel, "replace")}
      >
        Import
      </button>
      <button
        data-testid="insert-button"
        title={
          disabled
            ? "Wait for the current load to finish"
            : "Append imported blocks to current scene at +X offset"
        }
        style={buttonStyle(disabled)}
        disabled={disabled}
        onClick={() => runEquisetaImport(graph, sourceLabel, "append")}
      >
        Insert
      </button>
    </div>
  );
}
