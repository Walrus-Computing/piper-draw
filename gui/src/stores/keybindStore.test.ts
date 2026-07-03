import { describe, expect, it } from "vitest";
import { keybindMigrate, keybindMerge, useKeybindStore } from "./keybindStore";

function freshState() {
  // The store's initial state — what `keybindMerge` will fall back to when a
  // persisted field is missing.
  return useKeybindStore.getState();
}

describe("keybindMigrate (navStyle reset on default flip)", () => {
  it("drops persisted navStyle when fromVersion < 17", () => {
    const out = keybindMigrate({ navStyle: "rotate", bindings: {} }, 16) as Record<string, unknown>;
    expect(out.navStyle).toBeUndefined();
    // Other fields survive.
    expect(out.bindings).toEqual({});
  });

  it("preserves persisted navStyle when fromVersion >= 17", () => {
    const out = keybindMigrate({ navStyle: "rotate" }, 17) as Record<string, unknown>;
    expect(out.navStyle).toBe("rotate");
  });

  it("treats unversioned (fromVersion = 0) records as pre-v17 — drops navStyle", () => {
    const out = keybindMigrate({ navStyle: "pan" }, 0) as Record<string, unknown>;
    expect(out.navStyle).toBeUndefined();
  });

  it("treats NaN / non-finite fromVersion as old — drops navStyle", () => {
    const out = keybindMigrate({ navStyle: "pan" }, NaN) as Record<string, unknown>;
    expect(out.navStyle).toBeUndefined();
    const out2 = keybindMigrate({ navStyle: "pan" }, undefined as unknown as number) as Record<string, unknown>;
    expect(out2.navStyle).toBeUndefined();
  });

  it("does not collateral-damage other persisted fields", () => {
    const persisted = {
      navStyle: "pan",
      cameraFollowsBuild: true,
      axisAbsoluteWasd: true,
      bindings: { build: {}, edit: {} },
    };
    const out = keybindMigrate(persisted, 15) as Record<string, unknown>;
    expect(out.cameraFollowsBuild).toBe(true);
    expect(out.axisAbsoluteWasd).toBe(true);
    expect(out.bindings).toEqual({ build: {}, edit: {} });
  });
});

describe("keybindMerge (post-migration rehydrate)", () => {
  it("post-v17-migration: a pre-v17 user with navStyle:'rotate' lands on the new 'pan' default", () => {
    const migrated = keybindMigrate({ navStyle: "rotate", bindings: {} }, 16);
    const merged = keybindMerge(migrated, freshState());
    expect(merged.navStyle).toBe("pan");
  });

  it("preserves an explicit user choice when navStyle is still present", () => {
    const merged = keybindMerge({ navStyle: "rotate" }, freshState());
    expect(merged.navStyle).toBe("rotate");
  });

  it("falls back to the current default for invalid navStyle values", () => {
    const merged = keybindMerge({ navStyle: "wobble" } as unknown as object, freshState());
    expect(merged.navStyle).toBe("pan");
  });

  it("preserves persisted boolean toggles even when navStyle is missing", () => {
    const migrated = keybindMigrate(
      { navStyle: "pan", cameraFollowsBuild: true, axisAbsoluteWasd: true },
      15,
    );
    const merged = keybindMerge(migrated, freshState());
    expect(merged.cameraFollowsBuild).toBe(true);
    expect(merged.axisAbsoluteWasd).toBe(true);
  });
});
