import { useMemo } from "react";
import { useBlockStore } from "../stores/blockStore";

/**
 * Persistent passive signal for the presence of view-only blocks in the scene.
 *
 * Renders a small top-right pill `"N view-only block(s)"` whenever any block
 * carries `freeBuildOnly`. Decouples the "scene contains non-TQEC content"
 * signal from the `ValidationToast` lifecycle so the affordance survives toast
 * dismissal, snapshot URL share, and tab return-visits.
 *
 * Added via /autoplan 2026-05-12 design phase (both review voices flagged
 * toast-only as HIGH risk). Text content uses count + literal string only —
 * never interpolates `displayPattern` to avoid XSS via crafted JSON.
 */
export function StatusPill() {
  const blocks = useBlockStore((s) => s.blocks);

  const count = useMemo(() => {
    let n = 0;
    for (const block of blocks.values()) {
      if (block.freeBuildOnly !== undefined) n++;
    }
    return n;
  }, [blocks]);

  if (count === 0) return null;

  const label = count === 1 ? "1 view-only block" : `${count} view-only blocks`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Scene contains ${label}. These are rendered honestly from the imported JSON but are not valid TQEC structures.`}
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        padding: "4px 10px",
        background: "rgba(115, 150, 255, 0.92)",
        color: "#fff",
        font: "12px/16px system-ui, -apple-system, sans-serif",
        borderRadius: 12,
        border: "1px solid rgba(255, 255, 255, 0.4)",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
        zIndex: 50,
        pointerEvents: "none",
        userSelect: "none",
      }}
      data-testid="status-pill-view-only"
    >
      <span aria-hidden="true" style={{ marginRight: 4 }}>👁</span>
      {/* textContent only — never `dangerouslySetInnerHTML`. See JSDoc. */}
      {label}
    </div>
  );
}
