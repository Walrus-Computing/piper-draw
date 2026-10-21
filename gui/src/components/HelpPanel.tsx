import { useCallback, useEffect } from "react";
import { useTutorialStore } from "../stores/tutorialStore";

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
    <div className="pd-backdrop" onClick={handleBackdropClick}>
      <div className="pd-dialog" role="dialog" aria-label="About piper-draw">
        <div className="pd-dialog-head">
          <h3>About piper-draw</h3>
          <button className="pd-close" onClick={onClose} aria-label="Close help">
            ✕
          </button>
        </div>

        <p className="pd-lede">
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

        <button
          className="pd-cta"
          onClick={() => {
            useTutorialStore.getState().start();
            onClose();
          }}
        >
          Start the interactive tutorial
        </button>
        <p className="pd-cta-note">
          A hands-on tour: place cubes and pipes, verify, and analyze — every
          step is a real edit.
        </p>

        <section className="pd-section">
          <h4>Tips</h4>
          <ul>
            <li>Use <b>Undo</b>/<b>Redo</b> or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.</li>
            <li>
              <b>Camera</b> — drag to orbit, middle/right-drag (or{" "}
              <kbd>Shift</kbd>+drag) to pan, scroll to zoom. To make pan primary,
              switch to “Drag to pan” in View Settings; the gestures swap (drag pans,
              middle/right-drag and <kbd>Shift</kbd>/<kbd>Alt</kbd>+drag orbit).
              Turn on <b>Iso-Plane View</b>, then choose X, Y, or Z for an
              axis-locked orthographic view.
            </li>
            <li>
              <b>Shortcuts</b> — every key binding is listed and rebindable in
              the Customize panel; click <b>Customize</b> at the end of the hint
              bar (or press <kbd>?</kbd>).
            </li>
          </ul>
        </section>

        <section className="pd-section">
          <h4>Modes</h4>
          <ul>
            <li>
              <b>Drag / Drop</b> — arm a placement tool in the toolbar to
              click-place cubes, pipes, or ports, or switch to <b>Select</b>{" "}
              to pick blocks (click, Shift-click to add/remove from the
              selection, Ctrl+Shift-drag for a marquee). Hold the delete
              modifier to click-to-delete.
            </li>
            <li>
              <b>Keyboard</b> — choose it under <b>Build Mode</b> to move a
              cursor with the keyboard and extend from the last block.
            </li>
          </ul>
        </section>

        <section className="pd-section">
          <h4>Groups</h4>
          <ul>
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
        </section>

        <section className="pd-section">
          <h4>Analysis</h4>
          <ul>
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
        </section>

        <section className="pd-section">
          <h4>Files</h4>
          <ul>
            <li>
              Use <b>Import ▾</b> and <b>Export ▾</b> in the I/O column for
              Collada (.dae) and TQEC bgraph files; <b>Examples</b> opens the
              bundled reference circuits.
            </li>
          </ul>
        </section>

        <div className="pd-dialog-foot">
          <p>
            See the{" "}
            <a
              href="https://github.com/Walrus-Computing/piper-draw#readme"
              target="_blank"
              rel="noreferrer"
            >
              README
            </a>{" "}
            for more details, made by{" "}
            <a href="https://walruscomputing.com" target="_blank" rel="noreferrer">
              Walrus Computing
            </a>
            .
          </p>
          <a href="https://walruscomputing.com" target="_blank" rel="noreferrer" title="Made by Walrus Computing">
            <img src="/walrus-logo.svg" alt="Walrus Computing" />
          </a>
        </div>
      </div>
    </div>
  );
}
