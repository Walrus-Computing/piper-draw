import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { pickFile } from "./filePicker";

// We can't open a real OS file dialog in jsdom. Instead we capture the
// `<input type="file">` element pickFile creates, stub `click()` so it
// no-ops, then dispatch synthetic change/cancel events on it to drive
// the picker through its branches.

let capturedInput: HTMLInputElement | null = null;
let originalCreateElement: typeof document.createElement;

beforeEach(() => {
  capturedInput = null;
  originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = originalCreateElement(tag) as HTMLElement;
    if (tag === "input") {
      capturedInput = el as HTMLInputElement;
      el.click = vi.fn(); // stop the synthetic click from triggering a real dialog
    }
    return el as HTMLInputElement;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (capturedInput?.parentNode) capturedInput.parentNode.removeChild(capturedInput);
});

function setFiles(files: File[]) {
  if (!capturedInput) throw new Error("input not captured yet");
  const list = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
  } as unknown as FileList;
  // FileList is array-indexable too
  files.forEach((f, i) => {
    (list as unknown as Record<number, File>)[i] = f;
  });
  Object.defineProperty(capturedInput, "files", {
    value: list,
    configurable: true,
  });
}

function fireChange() {
  capturedInput?.dispatchEvent(new Event("change"));
}

function fireCancel() {
  capturedInput?.dispatchEvent(new Event("cancel"));
}

describe("pickFile", () => {
  it("resolves ok=true with the file text on successful selection", async () => {
    const promise = pickFile({ accept: ".json" });
    await Promise.resolve(); // let pickFile run synchronously up to input.click()
    setFiles([new File(['{"hello":"world"}'], "x.json", { type: "application/json" })]);
    fireChange();
    const result = await promise;
    expect(result).toEqual({ ok: true, text: '{"hello":"world"}' });
  });

  it("resolves ok=false reason=cancelled when the cancel event fires", async () => {
    const promise = pickFile({ accept: ".json" });
    await Promise.resolve();
    fireCancel();
    expect(await promise).toEqual({ ok: false, reason: "cancelled" });
  });

  it("resolves ok=false reason=cancelled when change fires with no file", async () => {
    const promise = pickFile({ accept: ".json" });
    await Promise.resolve();
    setFiles([]);
    fireChange();
    expect(await promise).toEqual({ ok: false, reason: "cancelled" });
  });

  it("resolves ok=false reason=oversized when file exceeds maxBytes", async () => {
    const promise = pickFile({ accept: ".json", maxBytes: 100 });
    await Promise.resolve();
    const big = new File(["x".repeat(500)], "big.json");
    // Sanity: jsdom should report a 500-byte size
    expect(big.size).toBe(500);
    setFiles([big]);
    fireChange();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("oversized");
      expect(result.message).toContain("500");
      expect(result.message).toContain("100");
    }
  });

  it("appends the input to the document body and removes it after resolution", async () => {
    const promise = pickFile({ accept: ".json" });
    await Promise.resolve();
    expect(capturedInput?.parentNode).toBe(document.body);
    fireCancel();
    await promise;
    expect(capturedInput?.parentNode).toBeNull();
  });

  // The `input.value = ""` reset on cleanup is a same-file-twice footgun
  // defence (vanilla `<input type=file>` won't fire `change` again if the
  // value didn't change). It's hard to meaningfully exercise in jsdom — the
  // platform security rule blocks programmatic non-empty assignment, so we
  // can't simulate the browser setting a path then verify our reset wipes
  // it. The behaviour is documented in the source; the integration check
  // happens at the equisetaJsonLoad level.
});
