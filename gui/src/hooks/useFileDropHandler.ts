// ---------------------------------------------------------------------------
// useFileDropHandler — mounts window-level dragenter/dragleave/drop listeners
// that dispatch file drops by extension. Design pick 2 (CEO plan):
//
//   - dragenter (only when dataTransfer.types contains "Files"): show overlay
//   - dragleave (relatedTarget === null, i.e. leaving the window): hide overlay
//   - drop: hide overlay, dispatch to onBgraph / onDae handler by extension
//   - Whitelist: .bgraph, .dae. Anything else → onUnsupportedExtension.
//   - File size > 5 MB → onTooLarge (no parse attempt).
//   - Concurrent drops (second drop while first is processing): ignored with
//     onConcurrentDrop callback fired so caller can surface a toast.
//
// Returns `isDragging` so the caller can render an overlay element.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface Handlers {
  onBgraph: (text: string, filename: string) => Promise<void> | void;
  onDae: (text: string, filename: string) => Promise<void> | void;
  onUnsupportedExtension?: (ext: string) => void;
  onTooLarge?: (filename: string) => void;
  onConcurrentDrop?: () => void;
  /** Disable file-drop dispatch entirely (e.g. while a modal is open). */
  disabled?: boolean;
}

function extOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

export function useFileDropHandler(handlers: Handlers): { isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);
  const processingRef = useRef(false);
  const dragDepthRef = useRef(0);

  // Keep latest handlers in a ref so the window listeners always call the
  // current closures (avoids stale-closure bugs when caller re-renders).
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (handlersRef.current.disabled) return;
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDragging(false);
    };
    const onDragOver = (e: DragEvent) => {
      if (handlersRef.current.disabled) return;
      if (!e.dataTransfer?.types.includes("Files")) return;
      // Without preventDefault here, the browser's default "open file" handler
      // fires on drop and navigates away from the SPA.
      e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (handlersRef.current.disabled) return;
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (!file) return;

      if (processingRef.current) {
        handlersRef.current.onConcurrentDrop?.();
        return;
      }

      const ext = extOf(file.name);
      // Treat .bgraph.json (and other compound) as just the trailing extension.
      // A file named "foo.bgraph.json" will have ext ".json" which we want to
      // reject as a bare-json by default. Only .bgraph and .dae are accepted.
      if (ext !== ".bgraph" && ext !== ".dae") {
        handlersRef.current.onUnsupportedExtension?.(ext || "(no extension)");
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        handlersRef.current.onTooLarge?.(file.name);
        return;
      }

      processingRef.current = true;
      try {
        const text = await file.text();
        if (ext === ".bgraph") {
          await handlersRef.current.onBgraph(text, file.name);
        } else {
          await handlersRef.current.onDae(text, file.name);
        }
      } finally {
        processingRef.current = false;
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return { isDragging };
}
