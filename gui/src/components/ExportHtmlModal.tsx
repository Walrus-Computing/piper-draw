// ---------------------------------------------------------------------------
// ExportHtmlModal — one-window popup for the "Export HTML" action.
//
// Bakes the scene once, renders a live <iframe> preview, and lets the user tune
// block opacity in real time: the opacity slider postMessages the iframe, which
// updates the material in place (no reload / no CDN refetch). "Copy snippet"
// bakes the current opacity into a paste-able <iframe srcdoc="…"> string.
//
// Rendered via a portal to <body> because the toolbar wrapper has a CSS
// transform, which would otherwise trap our position:fixed backdrop inside it.
// Mounted once (in BgraphDialogs) and gated on useExportHtmlStore; the inner
// dialog mounts fresh per open, so its state (and the bake) resets each time.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExportHtmlStore } from "../stores/exportHtmlStore";
import { useBlockStore } from "../stores/blockStore";
import { bakeScene, renderIframeDoc, buildIframeSnippet } from "../utils/htmlExport";

type CopyStatus = "idle" | "copied" | "error";

// Default block opacity: lower when correlation surfaces are present so they
// show through the blocks; opaque-ish otherwise.
const DEFAULT_OPACITY = 80;
const FLOW_OPACITY = 30;

const BACKDROP_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  overflow: "auto",
  padding: 16,
  zIndex: 2000,
};

const PANEL_STYLE: React.CSSProperties = {
  width: 640,
  maxWidth: "92vw",
  margin: "auto",
  background: "#fff",
  borderRadius: 6,
  boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: "6px 12px",
  border: "1px solid #0066cc",
  background: disabled ? "#cce0f5" : "#0066cc",
  color: "#fff",
  borderRadius: 4,
  cursor: disabled ? "default" : "pointer",
});

const plainBtn: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid #ccc",
  background: "#fff",
  borderRadius: 4,
  cursor: "pointer",
};

function OpacityRow({ opacity, setOpacity }: { opacity: number; setOpacity: (v: number) => void }) {
  // The number field keeps its own text so it can be transiently empty while
  // editing (backspacing to "" must not snap the value to 0). It syncs to the
  // numeric opacity only when the text parses, and restores on blur. The
  // slider-driven sync happens during render (React's recommended pattern for
  // adjusting state on a prop change) to avoid a cascading effect.
  const [text, setText] = useState(String(opacity));
  const [prevOpacity, setPrevOpacity] = useState(opacity);
  if (opacity !== prevOpacity) {
    setPrevOpacity(opacity);
    setText(String(opacity));
  }

  const onText = (raw: string) => {
    setText(raw);
    if (raw !== "") {
      const n = Number(raw);
      if (Number.isFinite(n)) setOpacity(Math.max(0, Math.min(100, n)));
    }
  };

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
      <span style={{ whiteSpace: "nowrap" }}>Block opacity</span>
      <input
        type="range"
        min={0}
        max={100}
        value={opacity}
        onChange={(e) => setOpacity(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <input
        type="number"
        min={0}
        max={100}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onBlur={() => setText(String(opacity))}
        style={{ width: 60, padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13 }}
      />
      <span>%</span>
    </label>
  );
}

function DialogFrame({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export HTML"
      style={BACKDROP_STYLE}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={PANEL_STYLE}>
        <div style={{ fontWeight: 600, fontFamily: "Arial", fontSize: 16 }}>Export HTML</div>
        {children}
      </div>
    </div>
  );
}

function DialogBody({
  empty,
  innerDoc,
  iframeRef,
  opacity,
  setOpacity,
  copyStatus,
  onCopy,
  onClose,
}: {
  empty: boolean;
  innerDoc: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  opacity: number;
  setOpacity: (v: number) => void;
  copyStatus: CopyStatus;
  onCopy: () => void;
  onClose: () => void;
}) {
  const copyLabel = copyStatus === "copied" ? "Copied!" : copyStatus === "error" ? "Copy failed" : "Copy snippet";
  if (empty) {
    return (
      <>
        <div style={{ fontSize: 13, color: "#c00" }}>The scene is empty — nothing to export.</div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={plainBtn}>
            Close
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <div style={{ fontSize: 13, fontFamily: "Arial", color: "#555" }}>
        Simply paste the snippet into your webpage's HTML. Drag to rotate, scroll to zoom, cmd + drag to move.
      </div>
      <OpacityRow opacity={opacity} setOpacity={setOpacity} />
      <iframe
        ref={iframeRef}
        srcDoc={innerDoc}
        title="piper-draw preview"
        onLoad={() =>
          iframeRef.current?.contentWindow?.postMessage({ __piperOpacity: opacity / 100 }, "*")
        }
        style={{ width: "100%", height: "min(55vh, 400px)", border: "1px solid #ccc", borderRadius: 4 }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
        <span style={{ fontSize: 12, color: copyStatus === "error" ? "#c00" : "#2a7", marginRight: "auto" }}>
          {copyStatus === "copied" ? "Copied to clipboard!" : copyStatus === "error" ? "Could not copy." : ""}
        </span>
        <button onClick={onCopy} style={primaryBtn(false)}>
          {copyLabel}
        </button>
        <button onClick={onClose} style={plainBtn}>
          Close
        </button>
      </div>
    </>
  );
}

function ExportHtmlDialog({ onClose }: { onClose: () => void }) {
  const scene = useMemo(() => {
    const s = useBlockStore.getState();
    // Include correlation surfaces iff they're currently shown in 3D (same gate
    // as FlowSurfaceOverlay): flow viz on + a valid selected flow.
    const surfaces =
      s.flowVizMode && s.selectedFlowIndex != null && s.selectedFlowIndex >= 0
        ? (s.flows[s.selectedFlowIndex]?.surfaces ?? null)
        : null;
    return bakeScene(s.blocks, s.hiddenFaces, s.showYDefects, surfaces);
  }, []);
  const empty = scene.mesh.positions.length === 0;
  const initialOpacity = scene.surfaces.length > 0 ? FLOW_OPACITY : DEFAULT_OPACITY;
  const innerDoc = useMemo(() => renderIframeDoc(scene, initialOpacity / 100), [scene, initialOpacity]);

  const [opacity, setOpacity] = useState(initialOpacity);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [onClose]);

  // Live-update the preview's opacity without reloading the iframe.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ __piperOpacity: opacity / 100 }, "*");
  }, [opacity]);

  const copy = async () => {
    const snippet = buildIframeSnippet(renderIframeDoc(scene, opacity / 100));
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus("idle"), 1600);
  };

  return createPortal(
    <DialogFrame onClose={onClose}>
      <DialogBody
        empty={empty}
        innerDoc={innerDoc}
        iframeRef={iframeRef}
        opacity={opacity}
        setOpacity={setOpacity}
        copyStatus={copyStatus}
        onCopy={() => void copy()}
        onClose={onClose}
      />
    </DialogFrame>,
    document.body,
  );
}

export function ExportHtmlModal() {
  const open = useExportHtmlStore((s) => s.open);
  const close = useExportHtmlStore((s) => s.close);
  if (!open) return null;
  return <ExportHtmlDialog onClose={close} />;
}
