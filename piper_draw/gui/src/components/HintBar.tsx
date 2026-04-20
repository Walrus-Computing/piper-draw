import { useRef, type ReactNode } from "react";
import { useViewportFitScale } from "../hooks/useViewportFitScale";

// Reserve horizontal space on both sides so the centered hint bar stays
// clear of the "?" help button at bottom-left (left: 20, width: 32 ⇒ right
// edge at 52). Margin is symmetric because the bar is centered; 64 px per
// side = 52 for the button + 12 px gap.
const HINT_BAR_VIEWPORT_MARGIN_PX = 128;

export function HintBar({
  hints,
  trailing,
}: {
  hints: ReadonlyArray<readonly [string, string]>;
  trailing?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const scale = useViewportFitScale(ref, HINT_BAR_VIEWPORT_MARGIN_PX);
  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: `translateX(-50%) scale(${scale})`,
        transformOrigin: "bottom center",
        zIndex: 1,
        display: "flex",
        gap: "6px",
        alignItems: "center",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        height: 32,
        boxSizing: "border-box",
        padding: "0 14px",
        borderRadius: "8px",
        fontSize: "12px",
        fontFamily: "sans-serif",
        pointerEvents: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        whiteSpace: "nowrap",
      }}
    >
      {hints.map(([key, action], i) => (
        <span key={key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {i > 0 && <span style={{ color: "rgba(255,255,255,0.3)" }}>|</span>}
          <kbd
            style={{
              background: "rgba(255,255,255,0.15)",
              padding: "1px 5px",
              borderRadius: "3px",
              fontSize: "11px",
            }}
          >
            {key}
          </kbd>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>{action}</span>
        </span>
      ))}
      {trailing != null && (
        <>
          <span style={{ color: "rgba(255,255,255,0.3)" }}>|</span>
          {trailing}
        </>
      )}
    </div>
  );
}

export function CustomizeLink({ onClick }: { onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        color: "rgba(255,255,255,0.5)",
        cursor: "pointer",
        pointerEvents: "auto",
        textDecoration: "underline",
        fontSize: "11px",
      }}
    >
      Customize
    </span>
  );
}
