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

        <h4 style={{ margin: "14px 0 4px", fontSize: 13 }}>Tips</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Use <b>Undo</b>/<b>Redo</b> or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.</li>
          <li>
            <b>Camera</b> — scroll to zoom, <kbd>Shift</kbd>/<kbd>Alt</kbd>+drag
            to rotate, drag to pan. Use the <b>Iso ▾</b> menu in the toolbar
            to snap to an axis-locked orthographic view.
          </li>
          <li>
            <b>Shortcuts</b> — every key binding is listed and rebindable in
            the Customize panel; click <b>Customize</b> at the end of the hint
            bar (or press <kbd>?</kbd>).
          </li>
        </ul>

        <h4 style={{ margin: "14px 0 4px", fontSize: 13 }}>Modes</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <b>Drag / Drop</b> — arm a placement tool in the toolbar to
            click-place cubes, pipes, or ports, or switch to <b>Select</b>
            to pick blocks (click, Shift-click to add/remove from the
            selection, Ctrl+Shift-drag for a marquee). Hold the delete
            modifier to click-to-delete.
          </li>
          <li>
            <b>Keyboard Build</b> — move a cursor with the keyboard to extend
            from the last block.
          </li>
        </ul>

        <h4 style={{ margin: "14px 0 4px", fontSize: 13 }}>Groups</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            Press <kbd>G</kbd> with 2+ blocks selected to group; press{" "}
            <kbd>G</kbd> again to ungroup. Grouped blocks share a colored
            dashed outline.
          </li>
          <li>
            Click any member to select the whole group;{" "}
            <kbd>Alt</kbd>+click drills in to a single block.
          </li>
          <li>
            <b>Verify</b> and <b>ZX</b> automatically scope to the selected
            group; copy/paste makes a fresh new group.
          </li>
        </ul>

        <h4 style={{ margin: "14px 0 4px", fontSize: 13 }}>Analysis</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>Verify (tqec)</b> — check that the diagram is a valid TQEC block graph via the <a href="https://github.com/tqec/tqec" target="_blank" rel="noreferrer">tqec</a> package.</li>
          <li>
            <b>Flows (tqec)</b> — compute stabilizer flows (correlation
            surfaces) via <a href="https://github.com/tqec/tqec" target="_blank" rel="noreferrer">tqec</a> and visualize each surface directly in 3D;
            edit the Pauli basis on ports to query custom flows.
          </li>
          <li>
            <b>ZX diagrams (tqec, pyzx)</b> — convert the diagram to a
            ZX-calculus graph, optionally simplify and extract the
            corresponding quantum circuit with{" "}
            <a href="https://github.com/zxcalc/pyzx" target="_blank" rel="noreferrer">PyZX</a>
            ; export to <code>.qgraph</code>, <code>.qasm</code>,{" "}
            <code>.qc</code>, or <code>.qsim</code>.
          </li>
        </ul>

        <h4 style={{ margin: "14px 0 4px", fontSize: 13 }}>Files</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>Import</b>/<b>Export</b> round-trip through Collada (.dae) files.</li>
          <li><b>Share link</b> copies a URL with the scene packed into the hash; opening it restores the diagram. Capped at 6 KB — use Export for larger scenes.</li>
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
