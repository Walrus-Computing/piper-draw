import { useCallback, useEffect, useState } from "react";
import type { BuildAction } from "../stores/keybindStore";
import {
  BUILD_ACTIONS,
  ACTION_LABELS,
  useKeybindStore,
  isDefaultBindings,
  keyToDisplayLabel,
} from "../stores/keybindStore";

export function KeybindEditor({ onClose }: { onClose: () => void }) {
  const bindings = useKeybindStore((s) => s.bindings);
  const setBinding = useKeybindStore((s) => s.setBinding);
  const resetToDefaults = useKeybindStore((s) => s.resetToDefaults);
  const [listening, setListening] = useState<BuildAction | null>(null);

  // Capture key when in listening mode
  useEffect(() => {
    if (!listening) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key.toLowerCase();
      // Ignore modifier-only presses
      if (["control", "shift", "alt", "meta"].includes(key)) return;
      setBinding(listening, key);
      setListening(null);
    };
    window.addEventListener("keydown", handler, true); // capture phase
    return () => window.removeEventListener("keydown", handler, true);
  }, [listening, setBinding]);

  // Close on Escape when not listening
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

  const showReset = !isDefaultBindings(bindings);

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
          minWidth: 320,
          maxWidth: 400,
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Build Mode Key Bindings</h3>
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

        {/* Binding rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {BUILD_ACTIONS.map((action) => {
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
                <span style={{ fontSize: 13, color: "#333" }}>{ACTION_LABELS[action]}</span>
                <button
                  onClick={() => setListening(isListeningThis ? null : action)}
                  style={{
                    minWidth: 60,
                    padding: "4px 10px",
                    border: isListeningThis ? "2px solid #4285f4" : "1px solid #ccc",
                    borderRadius: 4,
                    background: isListeningThis ? "#fff" : "#fff",
                    cursor: "pointer",
                    fontSize: 13,
                    fontFamily: "monospace",
                    color: isListeningThis ? "#4285f4" : "#333",
                    textAlign: "center",
                  }}
                >
                  {isListeningThis ? "Press a key…" : keyToDisplayLabel(binding.key)}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {showReset && (
          <div style={{ marginTop: 14, textAlign: "right" }}>
            <button
              onClick={resetToDefaults}
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
              Reset to defaults
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
