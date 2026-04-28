import type { SceneSnapshotV1 } from "../utils/sceneSnapshot";

export function SharedSceneBanner({
  previousSnapshot,
  onRestore,
  onDismiss,
}: {
  previousSnapshot: SceneSnapshotV1;
  onRestore: (snapshot: SceneSnapshotV1) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1100,
        background: "#fff8d6",
        border: "1px solid #d8c46a",
        borderRadius: 6,
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        padding: "8px 12px",
        fontFamily: "sans-serif",
        fontSize: 13,
        color: "#5b4a00",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span>Loaded a shared scene. Your previous work is still saved.</span>
      <button
        onClick={() => onRestore(previousSnapshot)}
        style={{
          fontSize: 12,
          padding: "4px 10px",
          border: "1px solid #b89a30",
          borderRadius: 4,
          background: "#fff",
          cursor: "pointer",
          color: "#5b4a00",
        }}
      >
        Restore previous
      </button>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
        style={{
          fontSize: 14,
          width: 22,
          height: 22,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "#7a6300",
          padding: 0,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
