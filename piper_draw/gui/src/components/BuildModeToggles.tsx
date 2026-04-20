import { useBlockStore } from "../stores/blockStore";
import { useKeybindStore } from "../stores/keybindStore";

export function BuildModeToggles() {
  const mode = useBlockStore((s) => s.mode);
  const cameraFollowsBuild = useKeybindStore((s) => s.cameraFollowsBuild);
  const toggleCameraFollowsBuild = useKeybindStore((s) => s.toggleCameraFollowsBuild);
  const axisAbsoluteWasd = useKeybindStore((s) => s.axisAbsoluteWasd);
  const toggleAxisAbsoluteWasd = useKeybindStore((s) => s.toggleAxisAbsoluteWasd);

  if (mode !== "build") return null;

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: 120,
        left: 16,
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "rgba(255,255,255,0.9)",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid #ddd",
        boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
        fontFamily: "sans-serif",
      }}
    >
      <button
        onClick={toggleCameraFollowsBuild}
        title="When off, the camera stays put while you build with the keyboard"
        style={toggleBtnStyle(cameraFollowsBuild)}
      >
        Camera Follow {cameraFollowsBuild ? "ON" : "OFF"}
      </button>
      <button
        onClick={toggleAxisAbsoluteWasd}
        title="When on, W/S = ±X and A/D = ±Y regardless of camera angle"
        style={toggleBtnStyle(axisAbsoluteWasd)}
      >
        Axis-Locked WASD {axisAbsoluteWasd ? "ON" : "OFF"}
      </button>
    </div>
  );
}

function toggleBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 11,
    fontFamily: "sans-serif",
    cursor: "pointer",
    border: active ? "2px solid #4a9eff" : "2px solid #ccc",
    borderRadius: 4,
    background: active ? "#e8f0fe" : "#fff",
    color: active ? "#1a5ec8" : "#333",
    fontWeight: "normal",
    textAlign: "left",
    whiteSpace: "nowrap",
  };
}
