import { useCallback, useEffect, useState } from "react";
import {
  ACTIONS,
  ACTION_LABELS,
  bindingToLabel,
  useKeybindStore,
  type ActionForMode,
  type KeyBinding,
  type Mode,
} from "../stores/keybindStore";

const MODE_TITLES: Record<Mode, string> = {
  build: "Build Mode Key Bindings",
  select: "Select Mode Key Bindings",
  place: "Place Mode Key Bindings",
  delete: "Delete Mode Key Bindings",
};

export function KeybindEditor<M extends Mode>({
  mode,
  onClose,
}: {
  mode: M;
  onClose: () => void;
}) {
  const bindings = useKeybindStore((s) => s.bindings[mode]) as Record<
    ActionForMode[M],
    KeyBinding
  >;
  const setBinding = useKeybindStore((s) => s.setBinding);
  const resetMode = useKeybindStore((s) => s.resetMode);
  const [listening, setListening] = useState<ActionForMode[M] | null>(null);

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
      setBinding(mode, listening, binding);
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

  const actions = ACTIONS[mode] as readonly ActionForMode[M][];
  const labels = ACTION_LABELS[mode] as Record<ActionForMode[M], string>;

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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{MODE_TITLES[mode]}</h3>
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

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {actions.map((action) => {
            const binding = bindings[action];
            const isListeningThis = listening === action;
            return (
              <div
                key={action as string}
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
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}
