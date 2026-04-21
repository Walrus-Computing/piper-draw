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

export type KeybindEditorTab = Mode | "general";

const TAB_LABELS: Record<KeybindEditorTab, string> = {
  general: "General",
  edit: "Drag / Drop",
  build: "Keyboard Build",
};

const TAB_ORDER: readonly KeybindEditorTab[] = ["general", "edit", "build"];

// General (mode-independent) shortcuts are hardcoded in App.tsx, not stored in
// the keybindStore — so they're shown here read-only.
const GENERAL_SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ["Tab", "Toggle Keyboard Build / Drag-Drop mode"],
  ["1", "Iso X view"],
  ["2", "Iso Y view"],
  ["3", "Iso Z view"],
  ["4", "3D view (re-centers camera)"],
  ["G", "Toggle grid"],
  ["H", "Toggle hint bar"],
  [".", "Focus camera on selection"],
  ["T", "Fit camera to total scene"],
  ["Ctrl/Cmd+C", "Copy selection"],
  ["Ctrl/Cmd+V", "Paste"],
  ["Ctrl/Cmd+S", "Export .dae"],
  ["?", "Show this shortcut list"],
];

export function KeybindEditor({
  initialMode,
  onClose,
}: {
  initialMode: KeybindEditorTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<KeybindEditorTab>(initialMode);
  const [listening, setListening] = useState<AnyAction | null>(null);
  const bindings = useKeybindStore((s) => s.bindings);
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
      // Only edit/build tabs can be listening (the General tab doesn't bind).
      if (tab === "edit" || tab === "build") {
        setBinding(tab, listening as never, binding);
      }
      setListening(null);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [listening, setBinding, tab]);

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

  const switchTab = (next: KeybindEditorTab) => {
    if (next === tab) return;
    setListening(null);
    setTab(next);
  };

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
          minWidth: 360,
          maxWidth: 460,
          maxHeight: "80vh",
          overflowY: "auto",
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
          {TAB_ORDER.map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => switchTab(t)}
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
                {TAB_LABELS[t]}
              </button>
            );
          })}
        </div>

        {tab === "general" ? (
          <GeneralList />
        ) : (
          <BindableList
            mode={tab}
            bindings={bindings[tab] as Record<AnyAction, KeyBinding>}
            listening={listening}
            setListening={setListening}
            onReset={() => resetMode(tab)}
          />
        )}
      </div>
    </div>
  );
}

function GeneralList() {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {GENERAL_SHORTCUTS.map(([key, action]) => (
          <div
            key={`${key}:${action}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "6px 8px",
              borderRadius: 6,
              background: "#f8f8f8",
            }}
          >
            <span style={{ fontSize: 13, color: "#333" }}>{action}</span>
            <span
              style={{
                minWidth: 60,
                padding: "4px 10px",
                border: "1px solid #ddd",
                borderRadius: 4,
                background: "#fafafa",
                fontSize: 13,
                fontFamily: "monospace",
                color: "#666",
                textAlign: "center",
              }}
            >
              {key}
            </span>
          </div>
        ))}
      </div>
      <p style={{ margin: "12px 2px 0", fontSize: 11, color: "#888" }}>
        General shortcuts are fixed and not rebindable.
      </p>
    </>
  );
}

function BindableList({
  mode,
  bindings,
  listening,
  setListening,
  onReset,
}: {
  mode: Mode;
  bindings: Record<AnyAction, KeyBinding>;
  listening: AnyAction | null;
  setListening: (a: AnyAction | null) => void;
  onReset: () => void;
}) {
  const actions = ACTIONS[mode] as readonly AnyAction[];
  const labels = ACTION_LABELS[mode] as Record<AnyAction, string>;
  return (
    <>
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
          onClick={onReset}
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
          Reset {TAB_LABELS[mode]} to defaults
        </button>
      </div>
    </>
  );
}
