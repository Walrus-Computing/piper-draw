import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BuildAction =
  | "moveForward"
  | "moveBack"
  | "moveLeft"
  | "moveRight"
  | "moveUp"
  | "moveDown"
  | "undo"
  | "cycleCubeType"
  | "toggleHadamard"
  | "exitBuild";

export type KeyBinding = {
  key: string; // e.key.toLowerCase() value
  displayLabel: string; // Human-readable label for tooltips
};

export const BUILD_ACTIONS: BuildAction[] = [
  "moveForward",
  "moveBack",
  "moveLeft",
  "moveRight",
  "moveUp",
  "moveDown",
  "undo",
  "cycleCubeType",
  "toggleHadamard",
  "exitBuild",
];

export const ACTION_LABELS: Record<BuildAction, string> = {
  moveForward: "Move forward",
  moveBack: "Move back",
  moveLeft: "Move left",
  moveRight: "Move right",
  moveUp: "Move up",
  moveDown: "Move down",
  undo: "Undo step",
  cycleCubeType: "Cycle type",
  toggleHadamard: "Hadamard",
  exitBuild: "Exit build",
};

export function keyToDisplayLabel(key: string): string {
  switch (key) {
    case "arrowup": return "↑";
    case "arrowdown": return "↓";
    case "arrowleft": return "←";
    case "arrowright": return "→";
    case "escape": return "Esc";
    case " ": return "Space";
    case "enter": return "Enter";
    case "backspace": return "Backspace";
    case "delete": return "Delete";
    case "tab": return "Tab";
    default: return key.length === 1 ? key.toUpperCase() : key;
  }
}

export const DEFAULT_BINDINGS: Record<BuildAction, KeyBinding> = {
  moveForward: { key: "w", displayLabel: "W" },
  moveBack: { key: "s", displayLabel: "S" },
  moveLeft: { key: "a", displayLabel: "A" },
  moveRight: { key: "d", displayLabel: "D" },
  moveUp: { key: "arrowup", displayLabel: "↑" },
  moveDown: { key: "arrowdown", displayLabel: "↓" },
  undo: { key: "q", displayLabel: "Q" },
  cycleCubeType: { key: "r", displayLabel: "R" },
  toggleHadamard: { key: "h", displayLabel: "H" },
  exitBuild: { key: "escape", displayLabel: "Esc" },
};

/** Reverse lookup: key string → BuildAction (or null if unbound) */
export function buildActionForKey(
  bindings: Record<BuildAction, KeyBinding>,
  key: string,
): BuildAction | null {
  for (const action of BUILD_ACTIONS) {
    if (bindings[action].key === key) return action;
  }
  return null;
}

/** Maps a movement action back to canonical WASD key for wasdToBuildDirection() */
export function actionToWasdKey(
  action: BuildAction,
): "w" | "a" | "s" | "d" | "arrowup" | "arrowdown" {
  switch (action) {
    case "moveForward": return "w";
    case "moveBack": return "s";
    case "moveLeft": return "a";
    case "moveRight": return "d";
    case "moveUp": return "arrowup";
    case "moveDown": return "arrowdown";
    default: throw new Error(`Not a movement action: ${action}`);
  }
}

interface KeybindState {
  bindings: Record<BuildAction, KeyBinding>;
  setBinding: (action: BuildAction, key: string) => void;
  resetToDefaults: () => void;
}

export const useKeybindStore = create<KeybindState>()(
  persist(
    (set) => ({
      bindings: { ...DEFAULT_BINDINGS },

      setBinding: (action, key) =>
        set((state) => {
          const displayLabel = keyToDisplayLabel(key);
          const newBindings = { ...state.bindings };

          // If another action uses this key, swap it
          const conflicting = buildActionForKey(newBindings, key);
          if (conflicting && conflicting !== action) {
            newBindings[conflicting] = { ...newBindings[action] };
          }

          newBindings[action] = { key, displayLabel };
          return { bindings: newBindings };
        }),

      resetToDefaults: () => set({ bindings: { ...DEFAULT_BINDINGS } }),
    }),
    {
      name: "piper-draw-keybinds",
      version: 1,
    },
  ),
);

export function isDefaultBindings(bindings: Record<BuildAction, KeyBinding>): boolean {
  for (const action of BUILD_ACTIONS) {
    if (bindings[action].key !== DEFAULT_BINDINGS[action].key) return false;
  }
  return true;
}
