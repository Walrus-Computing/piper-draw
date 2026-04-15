import { useBlockStore } from "../stores/blockStore";
import { useKeybindStore } from "../stores/keybindStore";

export function BuildModeHints({ onCustomize }: { onCustomize: () => void }) {
  const mode = useBlockStore((s) => s.mode);
  const bindings = useKeybindStore((s) => s.bindings);
  if (mode !== "build") return null;

  const hints = [
    [
      `${bindings.moveForward.displayLabel}/${bindings.moveLeft.displayLabel}/${bindings.moveBack.displayLabel}/${bindings.moveRight.displayLabel}`,
      "Move XY",
    ],
    [`${bindings.moveUp.displayLabel}/${bindings.moveDown.displayLabel}`, "Move Z"],
    [bindings.undo.displayLabel, "Undo step"],
    [bindings.cycleBlock.displayLabel, "Cycle block"],
    [bindings.toggleHadamard.displayLabel, "Hadamard"],
    [bindings.exitBuild.displayLabel, "Exit build"],
  ];

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
      <span style={{ color: "rgba(255,255,255,0.3)" }}>|</span>
      <span
        onClick={onCustomize}
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
    </div>
  );
}
