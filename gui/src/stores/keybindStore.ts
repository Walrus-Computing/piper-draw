import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isMac } from "../components/keyLabels";

export type Mode = "edit" | "build";

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
  | "deleteAtCursor"
  | "exitBuild";

export type EditAction =
  | "selectAll"
  | "deleteSelection"
  | "clearSelection"
  | "flipColors"
  | "holdToDelete"
  | "rotateCcw"
  | "rotateCw"
  | "rotateXCcw"
  | "rotateXCw"
  | "rotateYCcw"
  | "rotateYCw"
  | "flipX"
  | "flipY"
  | "flipZ"
  | "undo"
  | "redo"
  | "stepForward"
  | "stepBack"
  | "nudgeUp"
  | "nudgeDown"
  | "cyclePrev"
  | "cycleNext"
  | "copy"
  | "paste";

export type ActionForMode = {
  build: BuildAction;
  edit: EditAction;
};

export type AnyAction = BuildAction | EditAction;

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
    "undo", "cycleBlock", "cyclePipe", "deleteAtCursor", "exitBuild",
  ],
  edit: [
    "selectAll", "deleteSelection", "clearSelection", "flipColors", "holdToDelete",
    "rotateCcw", "rotateCw",
    "rotateXCcw", "rotateXCw", "rotateYCcw", "rotateYCw",
    "flipX", "flipY", "flipZ",
    "undo", "redo", "stepForward", "stepBack", "nudgeUp", "nudgeDown",
    "cyclePrev", "cycleNext",
    "copy", "paste",
  ],
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
    deleteAtCursor: "Delete block at cursor",
    exitBuild: "Exit build",
  },
  edit: {
    selectAll: "Select all",
    deleteSelection: "Delete selected",
    clearSelection: "Clear selection / disarm tool",
    flipColors: "Flip colors",
    holdToDelete: "Hold to delete on click",
    rotateCcw: "Rotate CCW (Z)",
    rotateCw: "Rotate CW (Z)",
    rotateXCcw: "Rotate CCW (X)",
    rotateXCw: "Rotate CW (X)",
    rotateYCcw: "Rotate CCW (Y)",
    rotateYCw: "Rotate CW (Y)",
    flipX: "Flip 180° (X)",
    flipY: "Flip 180° (Y)",
    flipZ: "Flip 180° (Z)",
    undo: "Undo",
    redo: "Redo",
    stepForward: "Step forward (iso)",
    stepBack: "Step back (iso)",
    nudgeUp: "Nudge selection +z",
    nudgeDown: "Nudge selection −z",
    cyclePrev: "Previous block / pipe",
    cycleNext: "Next block / pipe",
    copy: "Copy selection",
    paste: "Paste",
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
    deleteAtCursor: { key: "backspace" },
    exitBuild: { key: "escape" },
  },
  edit: {
    selectAll: { key: "a", ctrl: true },
    deleteSelection: { key: "backspace" },
    clearSelection: { key: "escape" },
    flipColors: { key: "f" },
    holdToDelete: { key: "x" },
    rotateCcw: { key: "r" },
    rotateCw: { key: "r", shift: true },
    rotateXCcw: { key: "e" },
    rotateXCw: { key: "e", shift: true },
    rotateYCcw: { key: "y" },
    rotateYCw: { key: "y", shift: true },
    flipX: { key: "b" },
    flipY: { key: "n" },
    flipZ: { key: "m" },
    undo: { key: "z", ctrl: true },
    redo: { key: "z", ctrl: true, shift: true },
    stepForward: { key: "arrowup" },
    stepBack: { key: "arrowdown" },
    nudgeUp: { key: "w" },
    nudgeDown: { key: "s" },
    cyclePrev: { key: "arrowleft" },
    cycleNext: { key: "arrowright" },
    copy: { key: "c", ctrl: true },
    paste: { key: "v", ctrl: true },
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

export type NavStyle = "pan" | "rotate";

interface KeybindState {
  bindings: BindingsByMode;
  cameraFollowsBuild: boolean;
  axisAbsoluteWasd: boolean;
  navStyle: NavStyle;
  setBinding: <M extends Mode>(mode: M, action: ActionForMode[M], binding: KeyBinding) => void;
  resetMode: (mode: Mode) => void;
  toggleCameraFollowsBuild: () => void;
  toggleAxisAbsoluteWasd: () => void;
  setNavStyle: (style: NavStyle) => void;
}

function cloneDefaults(): BindingsByMode {
  return {
    build: { ...DEFAULT_BINDINGS.build },
    edit: { ...DEFAULT_BINDINGS.edit },
  };
}

export const useKeybindStore = create<KeybindState>()(
  persist(
    (set) => ({
      bindings: cloneDefaults(),
      cameraFollowsBuild: false,
      axisAbsoluteWasd: false,
      navStyle: "pan",

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
      setNavStyle: (style) => set({ navStyle: style }),
    }),
    {
      name: "piper-draw-keybinds",
      version: 15,
      // Pass-through: schema is additive across versions (new EditActions only
      // get appended). The `merge` step below starts from `cloneDefaults()` and
      // walks the action list, picking up any persisted user bindings for
      // existing actions while letting new actions fall back to defaults — no
      // need to wipe state on migration.
      migrate: (persisted) => persisted as KeybindState,
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
          navStyle:
            p.navStyle === "pan" || p.navStyle === "rotate" ? p.navStyle : cur.navStyle,
        };
      },
    },
  ),
);
