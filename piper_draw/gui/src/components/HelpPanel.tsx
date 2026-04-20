import { useCallback, useEffect } from "react";

export function HelpPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "24px 28px",
          minWidth: 360,
          maxWidth: 520,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          color: "#222",
          lineHeight: 1.5,
          fontSize: 13,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>About piper-draw</h3>
          <button
            onClick={onClose}
            aria-label="Close help"
            style={{
              background: "none",
              border: "none",
              fontSize: 18,
              cursor: "pointer",
              color: "#666",
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ marginTop: 0 }}>
          An open-source tool for building pipe diagrams used in topological
          quantum error correction. Assemble cubes and pipes on a 3D grid,
          then export your design for use with{" "}
          <a href="https://tqec.github.io/tqec/" target="_blank" rel="noreferrer">
            TQEC
          </a>
          . Naming follows the{" "}
          <a
            href="https://tqec.github.io/tqec/user_guide/terminology.html"
            target="_blank"
            rel="noreferrer"
          >
            TQEC terminology guide
          </a>
          .
        </p>

        <h4 style={{ margin: "14px 0 4px", fontSize: 13 }}>Modes</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>Place</b> — pick a block or pipe, then click a grid cell to add it.</li>
          <li><b>Select</b> — click or drag to select blocks; Shift-click to add/remove.</li>
          <li><b>Delete</b> — click a block to remove it.</li>
          <li><b>Keyboard Build</b> — move a cursor with the keyboard to extend from the last block.</li>
        </ul>

        <h4 style={{ margin: "14px 0 4px", fontSize: 13 }}>Tips</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Use <b>Undo</b>/<b>Redo</b> or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.</li>
          <li><b>Verify</b> checks that the diagram is a valid TQEC structure.</li>
          <li><b>Import</b>/<b>Export</b> round-trip through Collada (.dae) files.</li>
          <li>Use the X / Y / Z view buttons or drag to rotate the camera.</li>
        </ul>

        <p style={{ margin: "14px 0 0", fontSize: 12, color: "#666" }}>
          See the{" "}
          <a
            href="https://github.com/Walrus-Computing/piper-draw#readme"
            target="_blank"
            rel="noreferrer"
          >
            README
          </a>{" "}
          for more details.
        </p>
      </div>
    </div>
  );
}
