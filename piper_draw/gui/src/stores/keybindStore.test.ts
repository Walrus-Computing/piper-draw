import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_BINDINGS,
  actionForKey,
  actionToWasdKey,
  bindingMatchesEvent,
  bindingToLabel,
  isDefaultBindings,
  useKeybindStore,
} from "./keybindStore";

function reset() {
  useKeybindStore.setState({
    bindings: {
      build: { ...DEFAULT_BINDINGS.build },
      edit: { ...DEFAULT_BINDINGS.edit },
    },
    cameraFollowsBuild: false,
    axisAbsoluteWasd: false,
    navStyle: "pan",
  });
}

describe("bindingMatchesEvent", () => {
  it("matches when every modifier lines up", () => {
    expect(bindingMatchesEvent({ key: "z", ctrl: true }, "z", true, false, false)).toBe(true);
  });

  it("treats undefined modifiers as false", () => {
    expect(bindingMatchesEvent({ key: "a" }, "a", false, false, false)).toBe(true);
    expect(bindingMatchesEvent({ key: "a" }, "a", true, false, false)).toBe(false);
  });

  it("rejects when any modifier disagrees", () => {
    expect(bindingMatchesEvent({ key: "z", ctrl: true, shift: true }, "z", true, false, false)).toBe(false);
  });

  it("rejects when the key itself differs", () => {
    expect(bindingMatchesEvent({ key: "z" }, "x", false, false, false)).toBe(false);
  });
});

describe("actionForKey", () => {
  it("finds the action matching the event", () => {
    const result = actionForKey(DEFAULT_BINDINGS.build, "w", false, false, false);
    expect(result).toBe("moveForward");
  });

  it("distinguishes by modifier (Ctrl+Z undo vs Ctrl+Shift+Z redo)", () => {
    expect(actionForKey(DEFAULT_BINDINGS.edit, "z", true, false, false)).toBe("undo");
    expect(actionForKey(DEFAULT_BINDINGS.edit, "z", true, true, false)).toBe("redo");
  });

  it("returns null when no binding matches", () => {
    expect(actionForKey(DEFAULT_BINDINGS.build, "z", false, false, false)).toBe(null);
  });
});

describe("actionToWasdKey", () => {
  it("maps movement actions to their WASD/arrow key", () => {
    expect(actionToWasdKey("moveForward")).toBe("w");
    expect(actionToWasdKey("moveBack")).toBe("s");
    expect(actionToWasdKey("moveLeft")).toBe("a");
    expect(actionToWasdKey("moveRight")).toBe("d");
    expect(actionToWasdKey("moveUp")).toBe("arrowup");
    expect(actionToWasdKey("moveDown")).toBe("arrowdown");
  });

  it("throws for non-movement actions", () => {
    expect(() => actionToWasdKey("undo")).toThrow();
    expect(() => actionToWasdKey("cycleBlock")).toThrow();
  });
});

describe("bindingToLabel", () => {
  it("shows arrows and named keys with a human label", () => {
    expect(bindingToLabel({ key: "arrowup" })).toBe("\u2191");
    expect(bindingToLabel({ key: "escape" })).toBe("Esc");
    expect(bindingToLabel({ key: "backspace" })).toBe("Backspace");
    expect(bindingToLabel({ key: " " })).toBe("Space");
  });

  it("uppercases single-character keys", () => {
    expect(bindingToLabel({ key: "w" })).toBe("W");
  });

  it("includes modifiers in the label", () => {
    const label = bindingToLabel({ key: "z", ctrl: true, shift: true });
    expect(label.toLowerCase()).toContain("z");
    // Mac uses unicode, non-mac uses Ctrl+/Shift+. Just check both variants.
    const hasMacModifiers = label.includes("\u2318") && label.includes("\u21E7");
    const hasWinModifiers = label.includes("Ctrl+") && label.includes("Shift+");
    expect(hasMacModifiers || hasWinModifiers).toBe(true);
  });
});

describe("isDefaultBindings", () => {
  it("returns true for the default bindings", () => {
    expect(isDefaultBindings("build", DEFAULT_BINDINGS.build)).toBe(true);
    expect(isDefaultBindings("edit", DEFAULT_BINDINGS.edit)).toBe(true);
  });

  it("returns false when any binding differs", () => {
    const mutated = { ...DEFAULT_BINDINGS.build, moveForward: { key: "i" } };
    expect(isDefaultBindings("build", mutated)).toBe(false);
  });

  it("returns false when a modifier differs even if the key matches", () => {
    const mutated = {
      ...DEFAULT_BINDINGS.build,
      moveForward: { key: "w", ctrl: true },
    };
    expect(isDefaultBindings("build", mutated)).toBe(false);
  });
});

describe("useKeybindStore.setBinding", () => {
  beforeEach(reset);

  it("assigns a new, non-conflicting binding", () => {
    useKeybindStore.getState().setBinding("build", "moveForward", { key: "i" });
    expect(useKeybindStore.getState().bindings.build.moveForward).toEqual({ key: "i" });
  });

  it("swaps bindings when the new key conflicts with another action in the same mode", () => {
    // Default: moveForward=w, moveBack=s. Rebind moveForward to "s" → moveBack should take "w".
    useKeybindStore.getState().setBinding("build", "moveForward", { key: "s" });
    const b = useKeybindStore.getState().bindings.build;
    expect(b.moveForward).toEqual({ key: "s" });
    expect(b.moveBack).toEqual({ key: "w" });
  });

  it("does not swap across modes when the same key is already used in the other mode", () => {
    // Edit has flipColors=f; rebinding build.moveForward to "f" must NOT touch edit.
    useKeybindStore.getState().setBinding("build", "moveForward", { key: "f" });
    expect(useKeybindStore.getState().bindings.build.moveForward).toEqual({ key: "f" });
    expect(useKeybindStore.getState().bindings.edit.flipColors).toEqual({ key: "f" });
  });

  it("preserves modifiers when swapping", () => {
    // edit: undo = ctrl+z, redo = ctrl+shift+z. Assign selectAll to ctrl+z, it should
    // swap bindings so undo picks up selectAll's old binding (ctrl+a).
    useKeybindStore.getState().setBinding("edit", "selectAll", { key: "z", ctrl: true });
    const b = useKeybindStore.getState().bindings.edit;
    expect(b.selectAll).toEqual({ key: "z", ctrl: true });
    expect(b.undo).toEqual({ key: "a", ctrl: true });
    // redo (ctrl+shift+z) must be untouched — different modifier mask.
    expect(b.redo).toEqual({ key: "z", ctrl: true, shift: true });
  });

  it("is idempotent when rebinding an action to its current key", () => {
    const before = { ...useKeybindStore.getState().bindings.build };
    useKeybindStore.getState().setBinding("build", "moveForward", { key: "w" });
    expect(useKeybindStore.getState().bindings.build).toEqual(before);
  });
});

describe("useKeybindStore.resetMode", () => {
  beforeEach(reset);

  it("restores defaults for the given mode only", () => {
    useKeybindStore.getState().setBinding("build", "moveForward", { key: "i" });
    useKeybindStore.getState().setBinding("edit", "flipColors", { key: "g" });
    useKeybindStore.getState().resetMode("build");

    expect(useKeybindStore.getState().bindings.build).toEqual(DEFAULT_BINDINGS.build);
    // Edit mode should be untouched.
    expect(useKeybindStore.getState().bindings.edit.flipColors).toEqual({ key: "g" });
  });
});
