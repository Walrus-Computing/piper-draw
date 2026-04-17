import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isMac } from "../components/keyLabels";

export type Mode = "select" | "place" | "delete" | "build";

export type BuildAction =
  | "moveForward"
  | "moveBack"
  | "moveLeft"
  | "moveRight"
  | "moveUp"
  | "moveDown"
  | "undo"
  | "cycleBlock"
  | "cyclePipe"
  | "exitBuild";

export type SelectAction =
  | "selectAll"
  | "deleteSelection"
  | "clearSelection"
  | "undo"
  | "redo"
  | "stepForward"
  | "stepBack";

export type PlaceAction = "undo" | "redo" | "stepForward" | "stepBack";
export type DeleteAction = "undo" | "redo" | "stepForward" | "stepBack";

export type ActionForMode = {
  build: BuildAction;
  select: SelectAction;
  place: PlaceAction;
  delete: DeleteAction;
};

export type AnyAction = BuildAction | SelectAction | PlaceAction | DeleteAction;

export type KeyBinding = {
  key: string;     // e.key.toLowerCase()
  ctrl?: boolean;  // Cmd on Mac, Ctrl elsewhere
  shift?: boolean;
  alt?: boolean;
};

export const ACTIONS: { [M in Mode]: readonly ActionForMode[M][] } = {
  build: [
    "moveForward", "moveBack", "moveLeft", "moveRight",
    "moveUp", "moveDown",
    "undo", "cycleBlock", "cyclePipe", "exitBuild",
  ],
  select: ["selectAll", "deleteSelection", "clearSelection", "undo", "redo", "stepForward", "stepBack"],
  place: ["undo", "redo", "stepForward", "stepBack"],
  delete: ["undo", "redo", "stepForward", "stepBack"],
};

export const ACTION_LABELS: { [M in Mode]: Record<ActionForMode[M], string> } = {
  build: {
    moveForward: "Move forward",
    moveBack: "Move back",
    moveLeft: "Move left",
    moveRight: "Move right",
    moveUp: "Move up",
    moveDown: "Move down",
    undo: "Undo step",
    cycleBlock: "Cycle block",
    cyclePipe: "Cycle pipe",
    exitBuild: "Exit build",
  },
  select: {
    selectAll: "Select all",
    deleteSelection: "Delete selected",
    clearSelection: "Clear selection",
    undo: "Undo",
    redo: "Redo",
    stepForward: "Step forward (iso)",
    stepBack: "Step back (iso)",
  },
  place: {
    undo: "Undo",
    redo: "Redo",
    stepForward: "Step forward (iso)",
    stepBack: "Step back (iso)",
  },
  delete: {
    undo: "Undo",
    redo: "Redo",
    stepForward: "Step forward (iso)",
    stepBack: "Step back (iso)",
  },
};

export const DEFAULT_BINDINGS: { [M in Mode]: Record<ActionForMode[M], KeyBinding> } = {
  build: {
    moveForward: { key: "w" },
    moveBack: { key: "s" },
    moveLeft: { key: "a" },
    moveRight: { key: "d" },
    moveUp: { key: "arrowup" },
    moveDown: { key: "arrowdown" },
    undo: { key: "q" },
    cycleBlock: { key: "c" },
    cyclePipe: { key: "r" },
    exitBuild: { key: "escape" },
  },
  select: {
    selectAll: { key: "a", ctrl: true },
    deleteSelection: { key: "delete" },
    clearSelection: { key: "escape" },
    undo: { key: "z", ctrl: true },
    redo: { key: "z", ctrl: true, shift: true },
    stepForward: { key: "arrowup" },
    stepBack: { key: "arrowdown" },
  },
  place: {
    undo: { key: "z", ctrl: true },
    redo: { key: "z", ctrl: true, shift: true },
    stepForward: { key: "arrowup" },
    stepBack: { key: "arrowdown" },
  },
  delete: {
    undo: { key: "z", ctrl: true },
    redo: { key: "z", ctrl: true, shift: true },
    stepForward: { key: "arrowup" },
    stepBack: { key: "arrowdown" },
  },
};

function keyOnlyLabel(key: string): string {
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

export function bindingToLabel(b: KeyBinding): string {
  let s = "";
  if (b.ctrl) s += isMac ? "\u2318" : "Ctrl+";
  if (b.shift) s += isMac ? "\u21E7" : "Shift+";
  if (b.alt) s += isMac ? "\u2325" : "Alt+";
  s += keyOnlyLabel(b.key);
  return s;
}

export function bindingMatchesEvent(b: KeyBinding, key: string, ctrl: boolean, shift: boolean, alt: boolean): boolean {
  return (
    b.key === key &&
    !!b.ctrl === ctrl &&
    !!b.shift === shift &&
    !!b.alt === alt
  );
}

export function actionForKey<A extends string>(
  modeBindings: Record<A, KeyBinding>,
  key: string,
  ctrl: boolean,
  shift: boolean,
  alt: boolean,
): A | null {
  for (const action of Object.keys(modeBindings) as A[]) {
    if (bindingMatchesEvent(modeBindings[action], key, ctrl, shift, alt)) return action;
  }
  return null;
}

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

export function isDefaultBindings<M extends Mode>(
  mode: M,
  bindings: Record<ActionForMode[M], KeyBinding>,
): boolean {
  const defaults = DEFAULT_BINDINGS[mode] as Record<ActionForMode[M], KeyBinding>;
  for (const action of Object.keys(bindings) as ActionForMode[M][]) {
    const b = bindings[action];
    const d = defaults[action];
    if (b.key !== d.key || !!b.ctrl !== !!d.ctrl || !!b.shift !== !!d.shift || !!b.alt !== !!d.alt) {
      return false;
    }
  }
  return true;
}

type BindingsByMode = { [M in Mode]: Record<ActionForMode[M], KeyBinding> };

interface KeybindState {
  bindings: BindingsByMode;
  cameraFollowsBuild: boolean;
  axisAbsoluteWasd: boolean;
  setBinding: <M extends Mode>(mode: M, action: ActionForMode[M], binding: KeyBinding) => void;
  resetMode: (mode: Mode) => void;
  toggleCameraFollowsBuild: () => void;
  toggleAxisAbsoluteWasd: () => void;
}

function cloneDefaults(): BindingsByMode {
  return {
    build: { ...DEFAULT_BINDINGS.build },
    select: { ...DEFAULT_BINDINGS.select },
    place: { ...DEFAULT_BINDINGS.place },
    delete: { ...DEFAULT_BINDINGS.delete },
  };
}

export const useKeybindStore = create<KeybindState>()(
  persist(
    (set) => ({
      bindings: cloneDefaults(),
      cameraFollowsBuild: false,
      axisAbsoluteWasd: false,

      setBinding: (mode, action, binding) =>
        set((state) => {
          const modeBindings = { ...state.bindings[mode] } as Record<string, KeyBinding>;
          // Swap with conflicting action in the same mode (if any).
          const conflicting = actionForKey(
            modeBindings as never,
            binding.key,
            !!binding.ctrl,
            !!binding.shift,
            !!binding.alt,
          );
          if (conflicting && conflicting !== (action as string)) {
            modeBindings[conflicting] = { ...(modeBindings[action as string]) };
          }
          modeBindings[action as string] = binding;
          return {
            bindings: { ...state.bindings, [mode]: modeBindings },
          } as Partial<KeybindState>;
        }),

      resetMode: (mode) =>
        set((state) => ({
          bindings: { ...state.bindings, [mode]: { ...DEFAULT_BINDINGS[mode] } },
        })),

      toggleCameraFollowsBuild: () =>
        set((s) => ({ cameraFollowsBuild: !s.cameraFollowsBuild })),
      toggleAxisAbsoluteWasd: () =>
        set((s) => ({ axisAbsoluteWasd: !s.axisAbsoluteWasd })),
    }),
    {
      name: "piper-draw-keybinds",
      version: 5,
      migrate: () => ({ bindings: cloneDefaults() }),
      merge: (persisted, current) => {
        const p = persisted as Partial<KeybindState>;
        const cur = current as KeybindState;
        const merged = cloneDefaults();
        if (p.bindings) {
          for (const mode of Object.keys(merged) as Mode[]) {
            const stored = (p.bindings as Partial<BindingsByMode>)[mode] as Record<string, KeyBinding> | undefined;
            if (!stored) continue;
            const target = merged[mode] as Record<string, KeyBinding>;
            for (const action of Object.keys(target)) {
              const b = stored[action];
              if (b && typeof b.key === "string") target[action] = b;
            }
          }
        }
        return {
          ...cur,
          bindings: merged,
          cameraFollowsBuild:
            typeof p.cameraFollowsBuild === "boolean" ? p.cameraFollowsBuild : cur.cameraFollowsBuild,
          axisAbsoluteWasd:
            typeof p.axisAbsoluteWasd === "boolean" ? p.axisAbsoluteWasd : cur.axisAbsoluteWasd,
        };
      },
    },
  ),
);
