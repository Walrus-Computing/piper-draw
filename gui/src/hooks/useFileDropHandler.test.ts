// Tests for useFileDropHandler. Verifies extension-dispatch, size cap, and
// concurrent-drop logic. Uses jsdom + manual DragEvent dispatch (jsdom doesn't
// fully implement DataTransfer; we shim what we need).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @testing-library/react isn't in the project deps. Roll a minimal hook
// harness using ReactDOM client + act so the hook runs inside a real
// component tree (window-level listeners need a mounted hook to fire).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement, useEffect } from "react";

import { useFileDropHandler } from "./useFileDropHandler";

// Tiny harness: mount a component that calls the hook and records output.
interface HookHarness<T> {
  result: { current: T | null };
  unmount: () => void;
}

function mountHook<T>(useHook: () => T): HookHarness<T> {
  const result = { current: null as T | null };
  function HarnessComponent() {
    const value = useHook();
    useEffect(() => {
      result.current = value;
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(createElement(HarnessComponent));
  });
  return {
    result,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function makeDragEvent(type: string, file?: File): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  // jsdom: DataTransfer is read-only on DragEvent. Define our own.
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: ["Files"],
      files: file ? ([file] as unknown as FileList) : ([] as unknown as FileList),
    },
    writable: false,
  });
  return event;
}

function makeFile(name: string, content: string, sizeOverride?: number): File {
  const blob = new Blob([content], { type: "text/plain" });
  const file = new File([blob], name, { type: "text/plain" });
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, "size", { value: sizeOverride });
  }
  return file;
}

type BgraphCb = (text: string, filename: string) => Promise<void> | void;
type ExtCb = (ext: string) => void;
type SizeCb = (filename: string) => void;
describe("useFileDropHandler", () => {
  let onBgraph: ReturnType<typeof vi.fn<BgraphCb>>;
  let onDae: ReturnType<typeof vi.fn<BgraphCb>>;
  let onUnsupportedExtension: ReturnType<typeof vi.fn<ExtCb>>;
  let onTooLarge: ReturnType<typeof vi.fn<SizeCb>>;

  beforeEach(() => {
    onBgraph = vi.fn<BgraphCb>();
    onDae = vi.fn<BgraphCb>();
    onUnsupportedExtension = vi.fn<ExtCb>();
    onTooLarge = vi.fn<SizeCb>();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dispatches .bgraph drops to onBgraph", async () => {
    const h = mountHook(() =>
      useFileDropHandler({ onBgraph, onDae }),
    );
    const file = makeFile("scene.bgraph", "BLOCKGRAPH 0.1.0;\n");
    await act(async () => {
      window.dispatchEvent(makeDragEvent("drop", file));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onBgraph).toHaveBeenCalledTimes(1);
    expect(onBgraph.mock.calls[0][1]).toBe("scene.bgraph");
    expect(onDae).not.toHaveBeenCalled();
    h.unmount();
  });

  it("dispatches .dae drops to onDae", async () => {
    const h = mountHook(() =>
      useFileDropHandler({ onBgraph, onDae }),
    );
    const file = makeFile("scene.dae", "<COLLADA ...>");
    await act(async () => {
      window.dispatchEvent(makeDragEvent("drop", file));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onDae).toHaveBeenCalledTimes(1);
    expect(onBgraph).not.toHaveBeenCalled();
    h.unmount();
  });

  it("rejects unsupported extensions", async () => {
    const h = mountHook(() =>
      useFileDropHandler({ onBgraph, onDae, onUnsupportedExtension }),
    );
    const file = makeFile("scene.json", "{}");
    await act(async () => {
      window.dispatchEvent(makeDragEvent("drop", file));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onUnsupportedExtension).toHaveBeenCalledWith(".json");
    expect(onBgraph).not.toHaveBeenCalled();
    expect(onDae).not.toHaveBeenCalled();
    h.unmount();
  });

  it("rejects files over the 5 MB cap", async () => {
    const h = mountHook(() =>
      useFileDropHandler({ onBgraph, onDae, onTooLarge }),
    );
    const big = makeFile("huge.bgraph", "x", 6 * 1024 * 1024);
    await act(async () => {
      window.dispatchEvent(makeDragEvent("drop", big));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onTooLarge).toHaveBeenCalledWith("huge.bgraph");
    expect(onBgraph).not.toHaveBeenCalled();
    h.unmount();
  });

  it("respects the disabled flag (no dispatch when disabled)", async () => {
    const h = mountHook(() =>
      useFileDropHandler({ onBgraph, onDae, disabled: true }),
    );
    const file = makeFile("scene.bgraph", "BLOCKGRAPH 0.1.0;");
    await act(async () => {
      window.dispatchEvent(makeDragEvent("drop", file));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onBgraph).not.toHaveBeenCalled();
    h.unmount();
  });
});
