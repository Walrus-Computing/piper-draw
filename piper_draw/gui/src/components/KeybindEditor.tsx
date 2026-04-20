import { useCallback, useEffect, useState } from "react";
import {
  ACTIONS,
  ACTION_LABELS,
  bindingToLabel,
  useKeybindStore,
  type AnyAction,
  type KeyBinding,
  type Mode,
} from "../stores/keybindStore";

const MODE_TAB_LABELS: Record<Mode, string> = {
  edit: "Drag / Drop",
  build: "Keyboard Build",
};

export function KeybindEditor({
  initialMode,
  onClose,
}: {
  initialMode: Mode;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [listening, setListening] = useState<AnyAction | null>(null);
  const bindings = useKeybindStore((s) => s.bindings[mode]) as Record<AnyAction, KeyBinding>;
  const setBinding = useKeybindStore((s) => s.setBinding);
  const resetMode = useKeybindStore((s) => s.resetMode);

  useEffect(() => {
    if (!listening) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key.toLowerCase();
      if (["control", "shift", "alt", "meta"].includes(key)) return;
      const binding: KeyBinding = { key };
      if (e.ctrlKey || e.metaKey) binding.ctrl = true;
      if (e.shiftKey) binding.shift = true;
      if (e.altKey) binding.alt = true;
      // Cast is safe because `listening` was selected from the same mode's action list.
      setBinding(mode, listening as never, binding);
      setListening(null);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [listening, setBinding, mode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !listening) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [listening, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setListening(null);
    setMode(next);
  };

  const actions = ACTIONS[mode] as readonly AnyAction[];
  const labels = ACTION_LABELS[mode] as Record<AnyAction, string>;

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
          padding: "20px 24px",
          minWidth: 340,
          maxWidth: 420,
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Key Bindings</h3>
          <button
            onClick={onClose}
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

        {/* Mode tab switcher */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 3,
            background: "#f0f4f9",
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {(["edit", "build"] as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => switchMode(m)}
                style={{
                  flex: 1,
                  padding: "4px 12px",
                  border: "none",
                  borderRadius: 4,
                  background: active ? "#fff" : "transparent",
                  color: active ? "#1a5ec8" : "#555",
                  fontWeight: active ? 600 : "normal",
                  cursor: "pointer",
                  fontSize: 13,
                  fontFamily: "sans-serif",
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {MODE_TAB_LABELS[m]}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {actions.map((action) => {
            const binding = bindings[action];
            const isListeningThis = listening === action;
            return (
              <div
                key={action}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: isListeningThis ? "#e8f0fe" : "#f8f8f8",
                }}
              >
                <span style={{ fontSize: 13, color: "#333" }}>{labels[action]}</span>
                <button
                  onClick={() => setListening(isListeningThis ? null : action)}
                  style={{
                    minWidth: 60,
                    padding: "4px 10px",
                    border: isListeningThis ? "2px solid #4285f4" : "1px solid #ccc",
                    borderRadius: 4,
                    background: "#fff",
                    cursor: "pointer",
                    fontSize: 13,
                    fontFamily: "monospace",
                    color: isListeningThis ? "#4285f4" : "#333",
                    textAlign: "center",
                  }}
                >
                  {isListeningThis ? "Press a key…" : bindingToLabel(binding)}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14, textAlign: "right" }}>
          <button
            onClick={() => resetMode(mode)}
            style={{
              background: "none",
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "5px 12px",
              fontSize: 12,
              cursor: "pointer",
              color: "#555",
            }}
          >
            Reset {MODE_TAB_LABELS[mode]} to defaults
          </button>
        </div>
      </div>
    </div>
  );
}
