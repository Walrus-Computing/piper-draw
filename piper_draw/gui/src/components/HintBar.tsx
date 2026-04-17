import type { ReactNode } from "react";

export function HintBar({
  hints,
  trailing,
}: {
  hints: ReadonlyArray<readonly [string, string]>;
  trailing?: ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 60,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1,
        display: "flex",
        gap: "6px",
        alignItems: "center",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        padding: "6px 14px",
        borderRadius: "8px",
        fontSize: "12px",
        fontFamily: "sans-serif",
        pointerEvents: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        whiteSpace: "nowrap",
        maxWidth: "calc(100vw - 32px)",
        overflowX: "auto",
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
