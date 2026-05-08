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
  | "nextPort"
  | "prevPort"
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
  | "paste"
  | "groupToggle";

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
    "undo", "cycleBlock", "cyclePipe", "nextPort", "prevPort",
    "deleteAtCursor", "exitBuild",
  ],
  edit: [
    "selectAll", "deleteSelection", "clearSelection", "flipColors", "holdToDelete",
    "rotateCcw", "rotateCw",
    "rotateXCcw", "rotateXCw", "rotateYCcw", "rotateYCw",
    "flipX", "flipY", "flipZ",
    "undo", "redo", "stepForward", "stepBack", "nudgeUp", "nudgeDown",
    "cyclePrev", "cycleNext",
    "copy", "paste",
    "groupToggle",
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
    nextPort: "Next port",
    prevPort: "Previous port",
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
    groupToggle: "Group / ungroup selection",
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
    nextPort: { key: "p" },
    prevPort: { key: "p", shift: true },
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
    groupToggle: { key: "g" },
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

// Exported for unit testing. The `persist` config below is the only runtime caller.
//
// v16 (2026-05-07): the camera default flipped from "pan" → "rotate". Zustand
// persist had already written the old default into every prior user's
// localStorage, so the new default would otherwise never reach them. On
// migration we drop the persisted navStyle so `keybindMerge` falls back to
// the current default; users who explicitly preferred pan can re-pick it.
export function keybindMigrate(persisted: unknown, fromVersion: number): unknown {
  const p = (persisted ?? {}) as Partial<KeybindState> & Record<string, unknown>;
  // Treat NaN / non-numeric / undefined as "older than v16" — corrupted or
  // hand-edited records get the same one-time reset as anyone on v15.
  if (!Number.isFinite(fromVersion) || (fromVersion as number) < 16) {
    delete p.navStyle;
  }
  return p;
}

// Exported for unit testing. When a persisted scalar field is missing or
// invalid, the merge falls back to `current.<field>` — the *current* default.
// Useful for new fields and intentional resets (e.g. v16's navStyle reset),
// but it means a future default flip without a version bump would silently
// affect any user whose persisted record is missing that field.
export function keybindMerge(persisted: unknown, current: KeybindState): KeybindState {
  const p = (persisted ?? {}) as Partial<KeybindState>;
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
    ...current,
    bindings: merged,
    cameraFollowsBuild:
      typeof p.cameraFollowsBuild === "boolean" ? p.cameraFollowsBuild : current.cameraFollowsBuild,
    axisAbsoluteWasd:
      typeof p.axisAbsoluteWasd === "boolean" ? p.axisAbsoluteWasd : current.axisAbsoluteWasd,
    navStyle:
      p.navStyle === "pan" || p.navStyle === "rotate" ? p.navStyle : current.navStyle,
  };
}

export const useKeybindStore = create<KeybindState>()(
  persist(
    (set) => ({
      bindings: cloneDefaults(),
      cameraFollowsBuild: false,
      axisAbsoluteWasd: false,
      navStyle: "rotate",

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
      version: 16,
      migrate: (persisted, fromVersion) => keybindMigrate(persisted, fromVersion) as KeybindState,
      merge: (persisted, current) => keybindMerge(persisted, current as KeybindState),
    },
  ),
);
