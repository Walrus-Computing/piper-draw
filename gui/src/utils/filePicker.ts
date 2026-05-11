/**
 * Native file-picker helper. Extracted from the duplicated `triggerDaeImport`
 * idiom (`./daeImport.ts`) so callers don't have to re-roll the hidden-input
 * dance + cleanup + same-file-twice footgun fix.
 *
 * Returns a Result-style object so callers can branch on cancel vs. read
 * errors vs. oversize without try/catch. Mirrors the Result shape used by
 * `parseFtqcGraph` in `./equisetaJsonSchema.ts`.
 */

export type PickFileResult =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: "cancelled" | "oversized" | "read-error";
      message?: string;
    };

export interface PickFileOptions {
  /** File-input `accept` attribute (e.g. `".dae"` or `".json,application/json"`). */
  accept: string;
  /** Reject with `oversized` if the chosen file exceeds this many bytes. */
  maxBytes?: number;
}

/**
 * Open the native file dialog and read the selected file as UTF-8 text.
 *
 * Always resolves; never rejects. The Result-style API keeps caller code
 * branch-explicit (oversize → toast, read-error → toast, cancel → no-op,
 * ok → consume text).
 */
export function pickFile(opts: PickFileOptions): Promise<PickFileResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = opts.accept;
    input.style.display = "none";

    const cleanup = () => {
      // Reset value so re-selecting the same file in the SAME element
      // would still fire `change`. We throw the input away anyway, but
      // explicit > clever.
      input.value = "";
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve({ ok: false, reason: "cancelled" });
        return;
      }
      if (opts.maxBytes !== undefined && file.size > opts.maxBytes) {
        cleanup();
        resolve({
          ok: false,
          reason: "oversized",
          message: `File too large: ${file.size} bytes (max ${opts.maxBytes})`,
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        cleanup();
        resolve({ ok: true, text: reader.result as string });
      };
      reader.onerror = () => {
        const errMsg = reader.error?.message ?? "unknown read error";
        cleanup();
        resolve({ ok: false, reason: "read-error", message: errMsg });
      };
      reader.readAsText(file);
    });

    // Chrome/Firefox fire `cancel` on the input when the dialog closes
    // without a selection. Older browsers don't; in that case the promise
    // simply hangs, which is fine for our caller (no UI state was set).
    input.addEventListener("cancel", () => {
      cleanup();
      resolve({ ok: false, reason: "cancelled" });
    });

    document.body.appendChild(input);
    input.click();
  });
}
